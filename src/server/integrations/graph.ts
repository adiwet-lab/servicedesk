import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { acquireLease, releaseLease } from "@/server/jobs/lease";
import { audit } from "@/server/services/audit";
import { HttpError, httpJson, httpRequest } from "./http";

/**
 * Microsoft Graph (app-only, client credentials) — directory sync.
 * Required in each synced tenant: application permission User.Read.All with admin consent
 * for this app registration. Base URLs can be overridden for local mock servers only
 * outside production (GRAPH_LOGIN_BASE / GRAPH_API_BASE).
 */
const DEFAULT_LOGIN = "https://login.microsoftonline.com";
const DEFAULT_API = "https://graph.microsoft.com/v1.0";
const overridable = () => process.env.NODE_ENV !== "production";
export const graphLoginBase = () => ((overridable() && process.env.GRAPH_LOGIN_BASE) || DEFAULT_LOGIN).replace(/\/$/, "");
export const graphApiBase = () => ((overridable() && process.env.GRAPH_API_BASE) || DEFAULT_API).replace(/\/$/, "");
const clientId = () => process.env.GRAPH_CLIENT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_ID || "";
const clientSecret = () => process.env.GRAPH_CLIENT_SECRET || process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET || "";
export const graphConfigured = () => !!clientId() && !!clientSecret();

const tokens = new Map<string, { token: string; exp: number }>();
export function clearGraphTokenCache() { tokens.clear(); }

async function appToken(entraTenantId: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(entraTenantId)) throw new Error("Invalid tenant ID.");
  const hit = tokens.get(entraTenantId);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const body = new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" });
  const r = await httpRequest(`${graphLoginBase()}/${entraTenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), timeoutMs: 15_000,
  });
  const j = JSON.parse(r.text) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Token endpoint returned no access token.");
  tokens.set(entraTenantId, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

/** GET with throttling support (429/503 + Retry-After, up to 4 attempts). */
async function graphGet<T>(entraTenantId: string, url: string, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await httpJson<T>(url, { headers: { Authorization: `Bearer ${await appToken(entraTenantId)}`, ConsistencyLevel: "eventual" }, timeoutMs: 30_000 });
    } catch (e) {
      if (e instanceof HttpError && (e.status === 429 || e.status === 503) && attempt < 4) {
        await sleep(Math.min(e.retryAfterMs ?? 2 ** attempt * 1000, 30_000));
        continue;
      }
      if (e instanceof HttpError && e.status === 401 && attempt === 1) { tokens.delete(entraTenantId); continue; }
      throw e;
    }
  }
}

interface GraphUser {
  id: string; displayName: string | null; mail: string | null; userPrincipalName: string | null; jobTitle: string | null;
  employeeId: string | null; department: string | null; accountEnabled: boolean | null; manager?: { id: string } | null;
}

export async function fetchDirectoryUsers(entraTenantId: string, maxUsers = 50_000): Promise<GraphUser[]> {
  const base = graphApiBase();
  const origin = new URL(base).origin;
  let url: string | null = `${base}/users?$select=id,displayName,mail,userPrincipalName,jobTitle,employeeId,department,accountEnabled&$expand=manager($select=id)&$top=999`;
  const out: GraphUser[] = [];
  while (url) {
    const page: { value: GraphUser[]; "@odata.nextLink"?: string } = await graphGet(entraTenantId, url);
    out.push(...(page.value ?? []));
    if (out.length > maxUsers) throw new Error(`Directory has more than ${maxUsers} users — increase the limit.`);
    const next = page["@odata.nextLink"];
    // Never follow a nextLink to another host (the bearer token would leak).
    if (next && new URL(next).origin !== origin) throw new Error("Unexpected nextLink host.");
    url = next ?? null;
  }
  return out;
}

export interface SyncResult {
  fetched: number; created: number; linked: number; updated: number; deactivated: number; unchanged: number; managerLinks: number;
  skippedNotProvisioned: number; unmappedDepartments: string[]; error?: string; durationMs: number;
}

/**
 * Syncs one tenant's directory into local users (matched by tenant + object ID; pre-created
 * users are linked by email within the same tenant, exactly like sign-in).
 * - updates display name, email, job title, employee ID, department (by name or code within
 *   the tenant's company — unknown names are reported, never created) and manager;
 * - creates users only when the tenant auto-provisions (with its default role);
 * - deactivates users whose account is disabled and revokes their sessions;
 * - never re-activates users (an administrator decides).
 */
export async function syncTenantDirectory(tenantId: string, actor: Actor | null): Promise<SyncResult> {
  const started = Date.now();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { defaultRole: true } });
  const r: SyncResult = { fetched: 0, created: 0, linked: 0, updated: 0, deactivated: 0, unchanged: 0, managerLinks: 0, skippedNotProvisioned: 0, unmappedDepartments: [], durationMs: 0 };
  const holder = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const leaseKey = `jobs.graphSync.${tenant.id}`;
  if (!(await acquireLease(prisma, leaseKey, holder, 15 * 60_000))) throw new Error("A sync for this tenant is already running.");
  try {
    if (!graphConfigured()) throw new Error("Microsoft Graph is not configured (client ID / secret).");
    if (!tenant.isActive) throw new Error("Tenant is inactive.");
    const users = await fetchDirectoryUsers(tenant.entraTenantId);
    r.fetched = users.length;
    const depts = tenant.companyId ? await prisma.department.findMany({ where: { companyId: tenant.companyId, deletedAt: null }, select: { id: true, name: true, code: true } }) : [];
    const deptBy = new Map<string, string>();
    for (const d of depts) { deptBy.set(d.name.toLowerCase(), d.id); deptBy.set(d.code.toLowerCase(), d.id); }
    const unmapped = new Set<string>();
    const local = await prisma.user.findMany({ where: { tenantId: tenant.id, deletedAt: null } });
    const byOid = new Map(local.filter((u) => u.entraObjectId).map((u) => [u.entraObjectId!.toLowerCase(), u]));
    const byEmail = new Map(local.filter((u) => !u.entraObjectId).map((u) => [u.email.toLowerCase(), u]));
    const idByOid = new Map<string, string>();

    for (const g of users) {
      const oid = g.id.toLowerCase();
      const email = (g.mail || g.userPrincipalName || "").trim();
      let departmentId: string | undefined;
      if (g.department?.trim()) {
        departmentId = deptBy.get(g.department.trim().toLowerCase());
        if (!departmentId) unmapped.add(g.department.trim());
      }
      let u = byOid.get(oid);
      if (!u && email && byEmail.has(email.toLowerCase())) {
        u = byEmail.get(email.toLowerCase())!;
        await prisma.user.update({ where: { id: u.id }, data: { entraObjectId: g.id } });
        r.linked++;
      }
      if (!u) {
        if (!tenant.autoProvisionUsers || g.accountEnabled === false) { r.skippedNotProvisioned++; continue; }
        const created = await prisma.user.create({
          data: {
            tenantId: tenant.id, entraObjectId: g.id, email: email || `${g.id}@unknown`, displayName: g.displayName || email || g.id,
            jobTitle: g.jobTitle, employeeId: g.employeeId, companyId: tenant.companyId, departmentId: departmentId ?? null, status: "ACTIVE",
            ticketVisibility: tenant.defaultRole?.defaultTicketVisibility ?? "OWN",
            roles: tenant.defaultRoleId ? { create: [{ roleId: tenant.defaultRoleId }] } : undefined,
          },
        });
        idByOid.set(oid, created.id);
        r.created++;
        continue;
      }
      idByOid.set(oid, u.id);
      const data: Prisma.UserUncheckedUpdateInput = {};
      if (g.displayName && g.displayName !== u.displayName) data.displayName = g.displayName;
      if (email && email.toLowerCase() !== u.email.toLowerCase()) data.email = email;
      if ((g.jobTitle ?? null) !== u.jobTitle && g.jobTitle !== undefined) data.jobTitle = g.jobTitle;
      if (g.employeeId && g.employeeId !== u.employeeId) data.employeeId = g.employeeId;
      if (departmentId && departmentId !== u.departmentId) data.departmentId = departmentId;
      if (g.accountEnabled === false && u.status === "ACTIVE") {
        data.status = "INACTIVE";
        data.sessionVersion = { increment: 1 }; // signs the user out everywhere
        r.deactivated++;
      }
      if (Object.keys(data).length) {
        await prisma.user.update({ where: { id: u.id }, data });
        if (!data.status) r.updated++;
      } else r.unchanged++;
    }

    // Managers (second pass, once every user has a local ID).
    for (const g of users) {
      const me = idByOid.get(g.id.toLowerCase());
      if (!me) continue;
      const mgr = g.manager?.id ? idByOid.get(g.manager.id.toLowerCase()) ?? byOid.get(g.manager.id.toLowerCase())?.id : undefined;
      if (!mgr || mgr === me) continue;
      const res = await prisma.user.updateMany({ where: { id: me, OR: [{ managerId: null }, { managerId: { not: mgr } }] }, data: { managerId: mgr } });
      r.managerLinks += res.count;
    }
    r.unmappedDepartments = [...unmapped].sort().slice(0, 50);
  } catch (e) {
    r.error = (e instanceof HttpError ? `${e.message}${e.body ? `: ${e.body.slice(0, 200)}` : ""}` : (e as Error).message).slice(0, 500);
  } finally {
    r.durationMs = Date.now() - started;
    await prisma.tenant.update({ where: { id: tenant.id }, data: { lastGraphSyncAt: new Date(), lastGraphSyncResult: r as unknown as Prisma.InputJsonValue } });
    await audit(prisma, actor, { action: r.error ? "GRAPH_SYNC_FAILED" : "GRAPH_SYNC", entityType: "Tenant", entityId: tenant.id, newValue: { ...r } });
    await releaseLease(prisma, leaseKey, holder).catch(() => {});
  }
  return r;
}

/** Job-runner entry: syncs enabled tenants whose last sync is older than the interval. */
export async function runDueGraphSyncs(intervalHours: number) {
  if (intervalHours <= 0 || !graphConfigured()) return [];
  const cutoff = new Date(Date.now() - intervalHours * 3_600_000);
  const due = await prisma.tenant.findMany({ where: { graphSyncEnabled: true, isActive: true, OR: [{ lastGraphSyncAt: null }, { lastGraphSyncAt: { lt: cutoff } }] }, select: { id: true, name: true } });
  const out: { tenant: string; result: SyncResult | { error: string } }[] = [];
  for (const t of due) {
    try { out.push({ tenant: t.name, result: await syncTenantDirectory(t.id, null) }); }
    catch (e) { out.push({ tenant: t.name, result: { error: (e as Error).message } }); }
  }
  return out;
}
