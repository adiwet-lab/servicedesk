import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can } from "@/server/authz/guards";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { audit } from "@/server/services/audit";
import { getSettings } from "@/server/services/settings";
import { encryptSecret, decryptSecret, maskUrl } from "@/server/integrations/crypto";
import { buildAdaptiveCard, TEAMS_EVENTS, validateTeamsWebhook } from "@/server/integrations/teams";
import { httpRequest } from "@/server/integrations/http";
import { assertOutboundUrl } from "@/server/integrations/ssrf";
import { clearAssetCache, lookupAsset } from "@/server/integrations/assets";
import { graphConfigured, syncTenantDirectory } from "@/server/integrations/graph";
import { listApiTokens } from "@/server/integrations/bi";

function requireManager(actor: Actor) {
  if (isVendor(actor) || !can(actor, P.INTEGRATIONS_MANAGE)) throw new AuthorizationError("You cannot manage integrations.");
}

async function setSetting(tx: Prisma.TransactionClient | typeof prisma, key: string, value: unknown) {
  await tx.systemSetting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } });
}

export async function getIntegrationsOverview(actor: Actor) {
  requireManager(actor);
  const [settings, tenants, teams, tokens, outbox, counts] = await Promise.all([
    getSettings(prisma),
    prisma.tenant.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, type: true, entraTenantId: true, isActive: true, autoProvisionUsers: true, graphSyncEnabled: true, lastGraphSyncAt: true, lastGraphSyncResult: true } }),
    prisma.supportTeam.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, teamsWebhookEnc: true } }),
    listApiTokens(actor),
    prisma.integrationOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, channel: true, event: true, target: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true, nextAttemptAt: true } }),
    prisma.integrationOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const teamName = new Map(teams.map((t) => [`team:${t.id}`, t.name]));
  let assetKeySet = false;
  try { assetKeySet = !!settings["integrations.assets.apiKeyEnc"] && !!decryptSecret(settings["integrations.assets.apiKeyEnc"]); } catch { assetKeySet = false; }
  return {
    graph: { configured: graphConfigured(), intervalHours: settings["integrations.graph.syncIntervalHours"], tenants },
    teams: {
      events: settings["integrations.teams.events"], allEvents: TEAMS_EVENTS,
      teams: teams.map((t) => {
        let masked: string | null = null;
        if (t.teamsWebhookEnc) { try { masked = maskUrl(decryptSecret(t.teamsWebhookEnc)); } catch { masked = "(unreadable — re-enter)"; } }
        return { id: t.id, name: t.name, type: t.type, webhook: masked };
      }),
    },
    assets: { ...settings["integrations.assets"], apiKeySet: assetKeySet },
    tokens,
    outbox: outbox.map((o) => ({ ...o, targetName: teamName.get(o.target) ?? o.target })),
    outboxCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>,
  };
}

// ───────────────────────────── Graph ─────────────────────────────

export async function setTenantGraphSync(actor: Actor, tenantId: string, enabled: boolean) {
  requireManager(actor);
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw new NotFoundError();
  await prisma.tenant.update({ where: { id: tenantId }, data: { graphSyncEnabled: enabled } });
  await audit(prisma, actor, { action: "GRAPH_SYNC_TOGGLED", entityType: "Tenant", entityId: tenantId, oldValue: { enabled: t.graphSyncEnabled }, newValue: { enabled } });
}

export async function runGraphSyncNow(actor: Actor, tenantId: string) {
  requireManager(actor);
  if (!(await prisma.tenant.findUnique({ where: { id: tenantId } }))) throw new NotFoundError();
  return syncTenantDirectory(tenantId, actor);
}

export async function saveGraphInterval(actor: Actor, hours: number) {
  requireManager(actor);
  if (!Number.isInteger(hours) || hours < 0 || hours > 168) throw new ValidationError("Interval must be 0–168 hours.");
  await setSetting(prisma, "integrations.graph.syncIntervalHours", hours);
  await audit(prisma, actor, { action: "SETTING_CHANGED", entityType: "SystemSetting", entityId: "integrations.graph.syncIntervalHours", newValue: { hours } });
}

// ───────────────────────────── Teams ─────────────────────────────

export async function setTeamWebhook(actor: Actor, teamId: string, url: string | null) {
  requireManager(actor);
  const team = await prisma.supportTeam.findUnique({ where: { id: teamId } });
  if (!team) throw new NotFoundError();
  let enc: string | null = null;
  if (url && url.trim()) {
    try { validateTeamsWebhook(url); } catch (e) { throw new ValidationError((e as Error).message); }
    enc = encryptSecret(url.trim());
  }
  await prisma.supportTeam.update({ where: { id: teamId }, data: { teamsWebhookEnc: enc } });
  // The URL itself is a secret: audit only the host.
  await audit(prisma, actor, { action: enc ? "TEAMS_WEBHOOK_SET" : "TEAMS_WEBHOOK_CLEARED", entityType: "SupportTeam", entityId: teamId, newValue: enc ? { host: maskUrl(url!.trim()) } : null });
}

export async function testTeamWebhook(actor: Actor, teamId: string) {
  requireManager(actor);
  const team = await prisma.supportTeam.findUnique({ where: { id: teamId } });
  if (!team?.teamsWebhookEnc) throw new ValidationError("This team has no Teams webhook.");
  const url = validateTeamsWebhook(decryptSecret(team.teamsWebhookEnc));
  const card = buildAdaptiveCard({ title: "✅ Service Desk connection test", subtitle: team.name, facts: [["Sent by", actor.displayName], ["Time", new Date().toISOString()]], tone: "good" });
  try {
    await httpRequest(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card), timeoutMs: 10_000 });
  } catch (e) {
    throw new ValidationError(`Teams rejected the test message: ${(e as Error).message}`);
  }
}

export async function saveTeamsEvents(actor: Actor, events: string[]) {
  requireManager(actor);
  const valid = events.filter((e) => e in TEAMS_EVENTS);
  await setSetting(prisma, "integrations.teams.events", valid);
  await audit(prisma, actor, { action: "SETTING_CHANGED", entityType: "SystemSetting", entityId: "integrations.teams.events", newValue: { events: valid } });
}

// ───────────────────────────── Assets ─────────────────────────────

export const assetConfigSchema = z.object({
  provider: z.enum(["none", "demo", "rest"]),
  baseUrl: z.string().trim().max(500).default(""),
  lookupPath: z.string().trim().max(300).default("/api/v1/hardware/bytag/{tag}"),
  mapping: z.string().trim().max(4000).default(""),
  apiKey: z.string().max(2000).optional(),
  clearApiKey: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).default(false),
});

export async function saveAssetConfig(actor: Actor, raw: unknown) {
  requireManager(actor);
  const p = assetConfigSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Invalid asset settings");
  const c = p.data;
  const current = (await getSettings(prisma))["integrations.assets"];
  let mapping = current.mapping;
  if (c.mapping) {
    try {
      const m = JSON.parse(c.mapping) as unknown;
      if (!m || typeof m !== "object" || Array.isArray(m) || Object.values(m).some((v) => typeof v !== "string")) throw new Error();
      mapping = m as Record<string, string>;
    } catch { throw new ValidationError("Field mapping must be a JSON object of strings, e.g. {\"serial\": \"serial\"}."); }
  }
  if (c.provider === "rest") {
    if (!c.baseUrl) throw new ValidationError("Enter the asset system URL.");
    try { assertOutboundUrl(c.baseUrl, []); } catch (e) { throw new ValidationError(`${(e as Error).message} Add the host to INTEGRATIONS_ALLOWED_HOSTS.`); }
    if (!c.lookupPath.startsWith("/") || !c.lookupPath.includes("{tag}")) throw new ValidationError("Lookup path must start with / and contain {tag}.");
  }
  await prisma.$transaction(async (tx) => {
    await setSetting(tx, "integrations.assets", { provider: c.provider, baseUrl: c.baseUrl, lookupPath: c.lookupPath, mapping });
    if (c.clearApiKey) await setSetting(tx, "integrations.assets.apiKeyEnc", "");
    else if (c.apiKey && c.apiKey.trim()) await setSetting(tx, "integrations.assets.apiKeyEnc", encryptSecret(c.apiKey.trim()));
  });
  clearAssetCache();
  await audit(prisma, actor, { action: "ASSET_INTEGRATION_CHANGED", entityType: "SystemSetting", entityId: "integrations.assets",
    newValue: { provider: c.provider, baseUrl: c.baseUrl, lookupPath: c.lookupPath, apiKeyChanged: !!c.apiKey?.trim() || c.clearApiKey } });
}

export async function testAssetLookup(actor: Actor, tag: string) {
  requireManager(actor);
  clearAssetCache();
  return lookupAsset(tag);
}

// ───────────────────────────── Outbox ─────────────────────────────

export async function retryOutbox(actor: Actor, id: string) {
  requireManager(actor);
  const row = await prisma.integrationOutbox.findUnique({ where: { id } });
  if (!row) throw new NotFoundError();
  if (row.status === "SENT") throw new ValidationError("Already delivered.");
  await prisma.integrationOutbox.update({ where: { id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  await audit(prisma, actor, { action: "OUTBOX_RETRY", entityType: "IntegrationOutbox", entityId: id });
}
