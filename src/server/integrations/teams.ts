import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/services/settings";
import { decryptSecret } from "./crypto";
import { assertOutboundUrl, TEAMS_WEBHOOK_HOSTS } from "./ssrf";
import { httpRequest } from "./http";
import { translateServerText } from "@/i18n/server-text-translate";
import { ln } from "@/lib/localized";
import type { Locale } from "@/i18n/config";

type Tx = Prisma.TransactionClient;

export const TEAMS_EVENTS = {
  TICKET_CREATED: "New ticket for the team",
  TICKET_TRANSFERRED: "Ticket transferred to the team",
  SLA_BREACHED: "SLA breached",
  MAJOR_INCIDENT: "Major incident declared / updated / resolved",
} as const;
export type TeamsEvent = keyof typeof TEAMS_EVENTS;

export function validateTeamsWebhook(url: string) { return assertOutboundUrl(url, TEAMS_WEBHOOK_HOSTS); }

export interface CardInput {
  title: string;
  subtitle?: string;
  facts: [string, string | null | undefined][];
  text?: string;
  url?: string;
  tone?: "attention" | "warning" | "good" | "accent";
}

/** Adaptive Card 1.4 inside the Teams message envelope (incoming webhooks and Workflows both accept it). */
export function buildAdaptiveCard(c: CardInput, locale: Locale = "en") {
  const body: unknown[] = [
    { type: "TextBlock", text: c.title, weight: "Bolder", size: "Medium", wrap: true, color: c.tone === "attention" ? "Attention" : c.tone === "warning" ? "Warning" : c.tone === "good" ? "Good" : "Accent" },
  ];
  if (c.subtitle) body.push({ type: "TextBlock", text: c.subtitle, isSubtle: true, spacing: "None", wrap: true });
  const facts = c.facts.filter(([, v]) => v != null && v !== "").map(([title, value]) => ({ title, value: String(value).slice(0, 300) }));
  if (facts.length) body.push({ type: "FactSet", facts });
  if (c.text) body.push({ type: "TextBlock", text: c.text.slice(0, 1000), wrap: true });
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body,
        ...(c.url ? { actions: [{ type: "Action.OpenUrl", title: translateServerText("Open ticket", locale), url: c.url }] } : {}),
      },
    }],
  };
}

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Queues a card for a team's channel (inside the caller's transaction, so it is only sent
 * if the business change commits). No-op when the team has no webhook or the event is off.
 * Cards contain operational metadata only — never descriptions, chat or internal notes;
 * confidential tickets are announced without their subject.
 */
export async function enqueueTeamsCard(tx: Tx, input: {
  teamId: string | null | undefined; event: TeamsEvent; ticketId: string;
  title: string; text?: string; extraFacts?: [string, string | null | undefined][]; tone?: CardInput["tone"];
}) {
  if (!input.teamId) return;
  const team = await tx.supportTeam.findUnique({ where: { id: input.teamId }, select: { id: true, name: true, nameTh: true, teamsWebhookEnc: true, isActive: true } });
  if (!team?.teamsWebhookEnc || !team.isActive) return;
  const settings = await getSettings(tx);
  if (!settings["integrations.teams.events"].includes(input.event)) return;
  const t = await tx.ticket.findUniqueOrThrow({
    where: { id: input.ticketId },
    select: { id: true, number: true, subject: true, isConfidential: true, priority: { select: { code: true, name: true, nameTh: true } }, status: { select: { name: true, nameTh: true } } },
  });
  // Channel cards have no single viewer: they use the system's default language (i18n.defaultLocale).
  const loc = settings["i18n.defaultLocale"];
  const tr = (x: string) => translateServerText(x, loc);
  const card = buildAdaptiveCard({
    title: tr(input.title),
    subtitle: t.isConfidential ? `${t.number} · ${tr("confidential")}` : `${t.number} · ${t.subject}`,
    facts: [[tr("Team"), ln(team, loc)], [tr("Priority"), `${t.priority.code} – ${ln(t.priority, loc)}`], [tr("Status"), ln(t.status, loc)],
      ...(input.extraFacts ?? []).map(([k, v]): [string, string | null | undefined] => [tr(k), v == null ? v : tr(v)])],
    text: t.isConfidential ? undefined : input.text, url: `${appUrl()}/admin/tickets/${encodeURIComponent(t.number)}`, tone: input.tone,
  }, loc);
  await tx.integrationOutbox.create({ data: { channel: "teams", event: input.event, target: `team:${team.id}`, payload: card as Prisma.InputJsonValue, ticketId: t.id } });
}

/** Sends one Teams card. Throws HttpError / Error on failure (the outbox decides on retry). */
export async function deliverTeams(target: string, payload: unknown) {
  const teamId = target.startsWith("team:") ? target.slice(5) : "";
  const team = await prisma.supportTeam.findUnique({ where: { id: teamId }, select: { teamsWebhookEnc: true } });
  if (!team?.teamsWebhookEnc) throw new PermanentError("The team no longer has a Teams webhook.");
  const url = validateTeamsWebhook(decryptSecret(team.teamsWebhookEnc));
  await httpRequest(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), timeoutMs: 10_000 });
}

export class PermanentError extends Error {}
