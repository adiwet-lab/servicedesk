import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { assignTicket, createTicket } from "@/server/services/tickets";
import { declareMajorIncident, setImpact } from "@/server/services/incidents";
import { saveAssetConfig, setTeamWebhook, testAssetLookup, retryOutbox, getIntegrationsOverview } from "@/server/services/admin/integrations";
import { processOutbox } from "@/server/integrations/outbox";
import { clearGraphTokenCache, syncTenantDirectory } from "@/server/integrations/graph";
import { clearAssetCache, lookupAsset } from "@/server/integrations/assets";
import { createApiToken, revokeApiToken } from "@/server/integrations/bi";
import { GET as biGet } from "@/app/api/bi/v1/[feed]/route";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { json, startMockServer } from "./mock-server";

const E = { emma: "emma@contoso.example", lead: "lee.lead@contoso.example", admin: "sys.admin@contoso.example", superadmin: "super.admin@contoso.example", agent: "ana.agent@contoso.example", vendorA: "victor@vendor-a.example" };
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  return (await loadActor(prisma, u.id))!;
}
const cat = async (c: string) => (await prisma.category.findUniqueOrThrow({ where: { code: c } })).id;
const team = async (c: string) => prisma.supportTeam.findUniqueOrThrow({ where: { code: c } });

beforeAll(() => {
  process.env.INTEGRATIONS_ALLOW_LOOPBACK = "true";
  process.env.APP_URL = "https://servicedesk.test";
});
afterAll(async () => {
  delete process.env.INTEGRATIONS_ALLOW_LOOPBACK;
  await prisma.supportTeam.updateMany({ data: { teamsWebhookEnc: null } });
  await prisma.$disconnect();
});

// ───────────────────────────── Teams ─────────────────────────────

describe("Microsoft Teams channel cards", () => {
  it("rejects webhook URLs outside the allow-list; only integration managers may configure", async () => {
    const admin = await actor("admin");
    const it = await team("IT-SUPPORT");
    await expect(setTeamWebhook(admin, it.id, "https://evil.example.com/hook")).rejects.toThrow(/allow-list/);
    await expect(setTeamWebhook(admin, it.id, "https://10.1.2.3/hook")).rejects.toThrow(/IP addresses/);
    await expect(setTeamWebhook(await actor("lead"), it.id, "https://contoso.webhook.office.com/x")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setTeamWebhook(await actor("vendorA"), it.id, "https://contoso.webhook.office.com/x")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("queues a card in the business transaction, delivers it, and never leaks descriptions", async () => {
    const mock = await startMockServer((_req, res) => { res.writeHead(200); res.end("1"); });
    try {
      const admin = await actor("admin");
      const it = await team("IT-SUPPORT");
      await setTeamWebhook(admin, it.id, `${mock.url}/hook/it`);
      const stored = await prisma.supportTeam.findUniqueOrThrow({ where: { id: it.id } });
      expect(stored.teamsWebhookEnc).toMatch(/^v1\./);
      expect(stored.teamsWebhookEnc).not.toContain("127.0.0.1"); // encrypted at rest
      expect(await prisma.auditLog.findFirst({ where: { entityId: it.id, action: "TEAMS_WEBHOOK_SET" }, orderBy: { createdAt: "desc" } })).toMatchObject({ newValue: { host: expect.stringContaining("127.0.0.1") } });

      const t = await createTicket(await actor("emma"), { subject: "Teams card ticket", description: "SECRET-DESCRIPTION-TEXT do not post", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW") });
      const row = await prisma.integrationOutbox.findFirstOrThrow({ where: { ticketId: t.id, event: "TICKET_CREATED" } });
      expect(row.status).toBe("PENDING");
      const r = await processOutbox();
      expect(r.sent).toBeGreaterThanOrEqual(1);
      const req = mock.requests.find((q) => q.body.includes(t.number))!;
      expect(req.method).toBe("POST");
      expect(req.headers["content-type"]).toContain("application/json");
      const body = JSON.parse(req.body);
      expect(body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
      expect(req.body).not.toContain("SECRET-DESCRIPTION-TEXT");
      expect(req.body).toContain(`https://servicedesk.test/admin/tickets/${t.number}`);
      expect((await prisma.integrationOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SENT");
    } finally { await mock.close(); }
  });

  it("confidential tickets are announced without subject", async () => {
    const mock = await startMockServer((_req, res) => { res.writeHead(200); res.end("1"); });
    try {
      await setTeamWebhook(await actor("admin"), (await team("IT-SUPPORT")).id, `${mock.url}/hook`);
      const t = await createTicket(await actor("emma"), { subject: "CONFIDENTIAL-SUBJECT salary", description: "Confidential body text.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW"), isConfidential: "on" });
      await processOutbox();
      const req = mock.requests.find((q) => q.body.includes(t.number))!;
      expect(req.body).not.toContain("CONFIDENTIAL-SUBJECT");
      // Channel cards use the system default language (Thai unless changed in System Settings).
      expect(req.body).toContain("ข้อมูลลับ");
      expect(req.body).toContain("ทีม");
    } finally { await mock.close(); }
  });

  it("retries 5xx with backoff, honours Retry-After, stops on 4xx, and can be retried manually", async () => {
    let mode: "500" | "429" | "400" | "ok" = "500";
    const mock = await startMockServer((_req, res) => {
      if (mode === "500") { res.writeHead(500); res.end("boom"); return; }
      if (mode === "429") { res.writeHead(429, { "Retry-After": "120" }); res.end("slow down"); return; }
      if (mode === "400") { res.writeHead(400); res.end("bad card"); return; }
      res.writeHead(200); res.end("1");
    });
    try {
      const it = await team("IT-SUPPORT");
      await setTeamWebhook(await actor("admin"), it.id, `${mock.url}/hook`);
      const t = await createTicket(await actor("emma"), { subject: "Retry card ticket", description: "Retry body text.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW") });
      const id = (await prisma.integrationOutbox.findFirstOrThrow({ where: { ticketId: t.id } })).id;
      const now = Date.now();
      await processOutbox(prisma, { now: new Date(now) });
      let row = await prisma.integrationOutbox.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: "FAILED", attempts: 1 });
      expect(row.lastError).toContain("500");
      expect(row.nextAttemptAt.getTime() - now).toBe(60_000);
      // Not due yet → untouched.
      await processOutbox(prisma, { now: new Date(now + 30_000) });
      expect((await prisma.integrationOutbox.findUniqueOrThrow({ where: { id } })).attempts).toBe(1);
      mode = "429";
      await processOutbox(prisma, { now: new Date(now + 61_000) });
      row = await prisma.integrationOutbox.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: "FAILED", attempts: 2 });
      expect(row.nextAttemptAt.getTime() - (now + 61_000)).toBe(120_000);
      mode = "400";
      await processOutbox(prisma, { now: new Date(now + 200_000) });
      row = await prisma.integrationOutbox.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: "DEAD", attempts: 3 });
      mode = "ok";
      await retryOutbox(await actor("admin"), id);
      await processOutbox();
      expect((await prisma.integrationOutbox.findUniqueOrThrow({ where: { id } })).status).toBe("SENT");
    } finally { await mock.close(); }
  });

  it("transfers and major incidents queue cards for the receiving / involved teams", async () => {
    const admin = await actor("admin");
    const infra = await team("INFRA");
    await setTeamWebhook(admin, infra.id, "https://contoso.webhook.office.com/webhookb2/infra");
    await setTeamWebhook(admin, (await team("IT-SUPPORT")).id, "https://contoso.webhook.office.com/webhookb2/it");
    const t = await createTicket(await actor("emma"), { subject: "Transfer card ticket", description: "Transfer body text.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW") });
    await assignTicket(await actor("lead"), { ticketId: t.id, teamId: infra.id, reason: "Network side" });
    expect(await prisma.integrationOutbox.count({ where: { ticketId: t.id, event: "TICKET_TRANSFERRED", target: `team:${infra.id}` } })).toBe(1);
    const m = await createTicket(await actor("emma"), { subject: "Card incident ticket", description: "Incident body text.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW") });
    await setImpact(await actor("lead"), m.id, { impactScope: "COMPANY_WIDE" });
    await declareMajorIncident(await actor("lead"), m.id, { message: "Email is down for everyone." });
    expect(await prisma.integrationOutbox.count({ where: { ticketId: m.id, event: "MAJOR_INCIDENT" } })).toBe(1);
    // Overview shows masked webhooks only.
    const o = await getIntegrationsOverview(admin);
    const row = o.teams.teams.find((x) => x.id === infra.id)!;
    expect(row.webhook).toBe("https://contoso.webhook.office.com/…");
    await prisma.integrationOutbox.deleteMany({ where: { status: "PENDING", target: { contains: "team:" } } });
  });
});

// ───────────────────────────── Graph ─────────────────────────────

describe("Microsoft Graph directory sync", () => {
  const tid = randomUUID();
  const oid = { boss: randomUUID(), ann: randomUUID(), bob: randomUUID(), cat: randomUUID(), pre: randomUUID() };
  let tenantId = "";
  let calls429 = 0;

  beforeAll(async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { code: "CTR" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "EMPLOYEE" } });
    const t = await prisma.tenant.create({ data: { entraTenantId: tid, name: "Graph Test Tenant", type: "INTERNAL", companyId: company.id, autoProvisionUsers: true, defaultRoleId: role.id, graphSyncEnabled: true } });
    tenantId = t.id;
    const fin = await prisma.department.findFirstOrThrow({ where: { companyId: company.id, code: "FIN" } });
    await prisma.user.createMany({ data: [
      { tenantId, entraObjectId: oid.boss, email: "boss@graph.test", displayName: "Old Boss Name", companyId: company.id },
      { tenantId, entraObjectId: oid.bob, email: "bob@graph.test", displayName: "Bob", companyId: company.id, departmentId: fin.id },
      { tenantId, entraObjectId: null, email: "pre@graph.test", displayName: "Pre Created", companyId: company.id },
    ] });
  });

  it("pages users, creates/updates/links, maps departments and managers, deactivates disabled accounts, handles 429", async () => {
    const mock = await startMockServer((req, res) => {
      if (req.url.includes("/oauth2/v2.0/token")) {
        const p = new URLSearchParams(req.body);
        if (p.get("grant_type") !== "client_credentials" || p.get("client_secret") !== "test-secret") return json(res, 401, { error: "invalid_client" });
        return json(res, 200, { access_token: "tok-1", expires_in: 3600 });
      }
      if (req.headers.authorization !== "Bearer tok-1") return json(res, 401, { error: "unauthorized" });
      if (req.url.startsWith("/v1.0/users?") && !req.url.includes("page=2")) {
        return json(res, 200, {
          value: [
            { id: oid.boss, displayName: "Bianca Boss", mail: "boss@graph.test", userPrincipalName: "boss@graph.test", jobTitle: "Head of Finance", employeeId: "G100", department: "Finance", accountEnabled: true, manager: null },
            { id: oid.ann, displayName: "Ann New", mail: "ann@graph.test", userPrincipalName: "ann@graph.test", jobTitle: "Analyst", employeeId: "G101", department: "Finance", accountEnabled: true, manager: { id: oid.boss } },
            { id: oid.pre, displayName: "Pre Created", mail: "PRE@graph.test", userPrincipalName: "pre@graph.test", jobTitle: null, employeeId: null, department: "Warehouse", accountEnabled: true, manager: { id: oid.boss } },
          ],
          "@odata.nextLink": `${mock.url}/v1.0/users?page=2`,
        });
      }
      if (req.url === "/v1.0/users?page=2") {
        if (calls429++ === 0) { res.writeHead(429, { "Retry-After": "0" }); res.end(); return; }
        return json(res, 200, { value: [
          { id: oid.bob, displayName: "Bob", mail: "bob@graph.test", userPrincipalName: "bob@graph.test", jobTitle: null, employeeId: null, department: null, accountEnabled: false, manager: null },
          { id: oid.cat, displayName: "Cat Disabled", mail: "cat@graph.test", userPrincipalName: "cat@graph.test", accountEnabled: false, department: null, jobTitle: null, employeeId: null },
        ] });
      }
      json(res, 404, { error: "not found" });
    });
    process.env.GRAPH_LOGIN_BASE = mock.url;
    process.env.GRAPH_API_BASE = `${mock.url}/v1.0`;
    process.env.GRAPH_CLIENT_ID = "client-1";
    process.env.GRAPH_CLIENT_SECRET = "test-secret";
    clearGraphTokenCache();
    try {
      const bobBefore = await prisma.user.findFirstOrThrow({ where: { tenantId, email: "bob@graph.test" } });
      const r = await syncTenantDirectory(tenantId, await actor("superadmin"));
      expect(r.error).toBeUndefined();
      expect(r).toMatchObject({ fetched: 5, created: 1, linked: 1, deactivated: 1, skippedNotProvisioned: 1, unmappedDepartments: ["Warehouse"] });
      expect(calls429).toBe(2);

      const boss = await prisma.user.findFirstOrThrow({ where: { tenantId, entraObjectId: oid.boss }, include: { department: true } });
      expect(boss).toMatchObject({ displayName: "Bianca Boss", jobTitle: "Head of Finance", employeeId: "G100" });
      expect(boss.department?.code).toBe("FIN");
      const ann = await prisma.user.findFirstOrThrow({ where: { tenantId, entraObjectId: oid.ann }, include: { roles: { include: { role: true } } } });
      expect(ann).toMatchObject({ status: "ACTIVE", managerId: boss.id, email: "ann@graph.test" });
      expect(ann.roles.map((x) => x.role.code)).toEqual(["EMPLOYEE"]);
      const pre = await prisma.user.findFirstOrThrow({ where: { tenantId, email: "pre@graph.test" } });
      expect(pre.entraObjectId).toBe(oid.pre); // linked by email within the tenant
      expect(pre.managerId).toBe(boss.id);
      const bob = await prisma.user.findUniqueOrThrow({ where: { id: bobBefore.id } });
      expect(bob.status).toBe("INACTIVE");
      expect(bob.sessionVersion).toBe(bobBefore.sessionVersion + 1); // signed out everywhere
      expect(await prisma.user.count({ where: { tenantId, entraObjectId: oid.cat } })).toBe(0); // disabled + unknown → not created

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant.lastGraphSyncAt).not.toBeNull();
      expect(await prisma.auditLog.count({ where: { entityId: tenantId, action: "GRAPH_SYNC" } })).toBe(1);
      // Users of other tenants are untouched.
      expect((await prisma.user.findFirstOrThrow({ where: { email: E.emma } })).status).toBe("ACTIVE");

      // Second run is idempotent.
      const again = await syncTenantDirectory(tenantId, null);
      expect(again).toMatchObject({ created: 0, linked: 0, deactivated: 0, managerLinks: 0 });
    } finally {
      await mock.close();
      delete process.env.GRAPH_LOGIN_BASE; delete process.env.GRAPH_API_BASE; delete process.env.GRAPH_CLIENT_ID; delete process.env.GRAPH_CLIENT_SECRET;
    }
  });

  it("refuses a nextLink to a foreign host and records the failure", async () => {
    const mock = await startMockServer((req, res) => {
      if (req.url.includes("/token")) return json(res, 200, { access_token: "tok-2", expires_in: 3600 });
      return json(res, 200, { value: [], "@odata.nextLink": "https://attacker.example/steal" });
    });
    process.env.GRAPH_LOGIN_BASE = mock.url; process.env.GRAPH_API_BASE = `${mock.url}/v1.0`; process.env.GRAPH_CLIENT_ID = "c"; process.env.GRAPH_CLIENT_SECRET = "s";
    clearGraphTokenCache();
    try {
      const r = await syncTenantDirectory(tenantId, null);
      expect(r.error).toMatch(/nextLink/);
      expect(mock.requests.some((q) => q.url.includes("steal"))).toBe(false);
      expect(await prisma.auditLog.count({ where: { entityId: tenantId, action: "GRAPH_SYNC_FAILED" } })).toBe(1);
    } finally {
      await mock.close();
      delete process.env.GRAPH_LOGIN_BASE; delete process.env.GRAPH_API_BASE; delete process.env.GRAPH_CLIENT_ID; delete process.env.GRAPH_CLIENT_SECRET;
    }
  });

  it("reports missing configuration instead of calling Microsoft", async () => {
    delete process.env.GRAPH_CLIENT_ID; delete process.env.GRAPH_CLIENT_SECRET;
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID; delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
    expect((await syncTenantDirectory(tenantId, null)).error).toMatch(/not configured/);
  });
});

// ───────────────────────────── Assets ─────────────────────────────

describe("IT asset lookup", () => {
  afterAll(async () => { await saveAssetConfig(await actor("admin"), { provider: "demo" }); clearAssetCache(); });

  it("demo provider finds seeded assets", async () => {
    clearAssetCache();
    expect((await lookupAsset("pos-bkk01-03")).asset).toMatchObject({ tag: "POS-BKK01-03", model: "Toshiba TCx 810" });
    expect((await lookupAsset("NOPE-1")).asset).toBeNull();
    expect((await lookupAsset("../etc/passwd")).error).toMatch(/Invalid/);
  });

  it("REST provider (Snipe-IT style) with API key, field mapping, 404 and status:error", async () => {
    const mock = await startMockServer((req, res) => {
      if (req.headers.authorization !== "Bearer snipe-key") return json(res, 401, { status: "error" });
      if (req.url === "/api/v1/hardware/bytag/LT-0042") return json(res, 200, { asset_tag: "LT-0042", name: "Laptop 42", serial: "SN42", model: { name: "ThinkPad X1" }, status_label: { name: "Deployed" }, assigned_to: { name: "Emma Employee" }, location: { name: "HQ" }, warranty_expires: { date: "2027-01-31" } });
      if (req.url === "/api/v1/hardware/bytag/GONE") return json(res, 200, { status: "error", messages: "Asset does not exist." });
      json(res, 404, {});
    });
    try {
      const admin = await actor("admin");
      await expect(saveAssetConfig(await actor("lead"), { provider: "demo" })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(saveAssetConfig(admin, { provider: "rest", baseUrl: "https://assets.not-allowed.example" })).rejects.toBeInstanceOf(ValidationError);
      await saveAssetConfig(admin, { provider: "rest", baseUrl: mock.url, lookupPath: "/api/v1/hardware/bytag/{tag}", apiKey: "snipe-key" });
      const setting = await prisma.systemSetting.findUniqueOrThrow({ where: { key: "integrations.assets.apiKeyEnc" } });
      expect(String(setting.value)).not.toContain("snipe-key");
      expect((await testAssetLookup(admin, "LT-0042")).asset).toEqual({ tag: "LT-0042", name: "Laptop 42", model: "ThinkPad X1", serial: "SN42", status: "Deployed", assignedTo: "Emma Employee", location: "HQ", warrantyExpires: "2027-01-31" });
      expect((await lookupAsset("GONE")).asset).toBeNull();
      expect((await lookupAsset("MISSING")).asset).toBeNull();
      expect(mock.requests.find((q) => q.url.includes("LT-0042"))!.headers.authorization).toBe("Bearer snipe-key");
      // Tag is URL-encoded into the path (no path traversal).
      await lookupAsset("A/B");
      expect(mock.requests.at(-1)!.url).toBe("/api/v1/hardware/bytag/A%2FB");
      // Custom mapping.
      await saveAssetConfig(admin, { provider: "rest", baseUrl: mock.url, lookupPath: "/api/v1/hardware/bytag/{tag}", mapping: JSON.stringify({ tag: "asset_tag", model: "name" }) });
      expect((await testAssetLookup(admin, "LT-0042")).asset).toMatchObject({ model: "Laptop 42", serial: null });
      await expect(saveAssetConfig(admin, { provider: "rest", baseUrl: mock.url, mapping: "[1,2]" })).rejects.toThrow(/JSON object/);
    } finally { await mock.close(); }
  });
});

// ───────────────────────────── Power BI ─────────────────────────────

describe("Power BI feeds", () => {
  const call = (feed: string, token?: string, qs = "") =>
    biGet(new Request(`https://servicedesk.test/api/bi/v1/${feed}${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }), { params: Promise.resolve({ feed }) });

  it("token lifecycle: managers only, shown once, hashed, revocable, expiring, scoped", async () => {
    await expect(createApiToken(await actor("lead"), { name: "nope" })).rejects.toBeInstanceOf(AuthorizationError);
    const admin = await actor("admin");
    const { id, token } = await createApiToken(admin, { name: "BI test token" });
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token);

    expect((await call("tickets")).status).toBe(401);
    expect((await call("tickets", "sdbi_wrong")).status).toBe(401);
    expect((await call("tickets", token)).status).toBe(200);
    expect((await call("nope", token)).status).toBe(404);
    expect((await prisma.apiToken.findUniqueOrThrow({ where: { id } })).lastUsedAt).not.toBeNull();

    await prisma.apiToken.update({ where: { id }, data: { scopes: ["other.scope"] } });
    expect((await call("tickets", token)).status).toBe(403);
    await prisma.apiToken.update({ where: { id }, data: { scopes: ["bi.read"], expiresAt: new Date(Date.now() - 1000) } });
    expect((await call("tickets", token)).status).toBe(403);
    await prisma.apiToken.update({ where: { id }, data: { expiresAt: null } });
    await revokeApiToken(admin, id);
    expect((await call("tickets", token)).status).toBe(401);
  });

  it("pages, filters incrementally and pseudonymises by default (never descriptions or chat)", async () => {
    const admin = await actor("admin");
    const { token } = await createApiToken(admin, { name: "BI paging token" });
    const first = await (await call("tickets", token, "?$top=2")).json();
    expect(first.value).toHaveLength(2);
    expect(first["@odata.nextLink"]).toContain("%24skip=2");
    const next = new URL(first["@odata.nextLink"]);
    const second = await (await call("tickets", token, next.search)).json();
    expect(second.value[0].id).not.toBe(first.value[0].id);
    const row = first.value[0];
    for (const k of ["description", "subject", "requesterName", "agentName", "resolutionSummary", "waitingReason"]) expect(row).not.toHaveProperty(k);
    expect(row.requesterKey).toMatch(/^u_/);
    expect(JSON.stringify(first)).not.toMatch(/@contoso\.example/);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await (await call("tickets", token, `?modifiedSince=${encodeURIComponent(future)}`)).json()).value).toHaveLength(0);
    expect((await call("tickets", token, "?modifiedSince=garbage")).status).toBe(400);
    for (const f of ["tasks", "sla-events", "teams", "categories", "priorities", "statuses", "branches", "departments"]) expect((await call(f, token)).status).toBe(200);
  });

  it("includeNames tokens add names and subjects, but never for confidential tickets", async () => {
    const { token } = await createApiToken(await actor("admin"), { name: "BI names token", includeNames: "on" });
    const conf = await createTicket(await actor("emma"), { subject: "BI confidential subject", description: "x".repeat(20), categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW"), isConfidential: "on" });
    const all = await (await call("tickets", token, "?$top=5000")).json();
    const c = all.value.find((v: { id: string }) => v.id === conf.id);
    expect(c.subject).toBeNull();
    expect(c.requesterName).toBe("Emma Employee");
    expect(all.value.some((v: { subject: string | null }) => typeof v.subject === "string")).toBe(true);
  });
});
