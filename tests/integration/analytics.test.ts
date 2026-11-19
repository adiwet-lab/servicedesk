import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { assignTicket, changeTicketStatus, createTicket } from "@/server/services/tickets";
import { createTask } from "@/server/services/tasks";
import { postMessage } from "@/server/services/messages";
import { getAging, getOverview, getSlaPerformance, getWorkload, parseAnalyticsFilters } from "@/server/services/analytics";
import { runReport } from "@/server/services/reports";
import { toCsv } from "@/server/domain/analytics";
import { AuthorizationError } from "@/server/authz/errors";

const E = { emma: "emma@contoso.example", ana: "ana.agent@contoso.example", lee: "lee.lead@contoso.example", admin: "sys.admin@contoso.example",
  mia: "mia.manager@contoso.example", vendorA: "victor@vendor-a.example", andy: "andy.analyst@contoso.example" };
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  return (await loadActor(prisma, u.id))!;
}
const DAY = 86_400_000;
let subId = "", teamId = "", cnx = "";
const ids: Record<string, string> = {};
const f = (extra: Record<string, string> = {}) => parseAnalyticsFilters({ range: "90d", subcategory: subId, ...extra });

beforeAll(async () => {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { entraTenantId: "11111111-1111-4111-8111-111111111111" } });
  const agentRole = await prisma.role.findUniqueOrThrow({ where: { code: "SUPPORT_AGENT" } });
  const andy = await prisma.user.create({ data: { tenantId: tenant.id, email: E.andy, displayName: "Andy Analyst", roles: { create: [{ roleId: agentRole.id }] } } });
  const team = await prisma.supportTeam.create({ data: { code: "ANALYTICS", name: "Analytics Team", members: { create: [{ userId: andy.id }] } } });
  teamId = team.id;
  const req = await prisma.category.findUniqueOrThrow({ where: { code: "REQ" } });
  subId = (await prisma.category.create({ data: { code: "REQ-ANL", name: "Analytics test", parentId: req.id, defaultTeamId: team.id } })).id;
  cnx = (await prisma.branch.findFirstOrThrow({ where: { code: "CNX01" } })).id;
  const prio = async (c: string) => (await prisma.priority.findUniqueOrThrow({ where: { code: c } })).id;
  const emma = await actor("emma");
  const specs: [string, string, number, string?][] = [["t0", "P1", 0], ["t2", "P2", 2], ["t5", "P3", 5, cnx], ["t10", "P3", 10], ["t20", "P4", 20]];
  for (const [key, p, ageDays, branchId] of specs) {
    const t = await createTicket(emma, {
      subject: key === "t10" ? "=HYPERLINK(\"http://evil\") analytics" : `Analytics ticket ${key}`, description: "Analytics integration test ticket.",
      categoryId: req.id, subcategoryId: subId, priorityId: await prio(p), ...(branchId ? { branchId } : {}),
    });
    ids[key] = t.id;
    await prisma.ticket.update({ where: { id: t.id }, data: { createdAt: new Date(Date.now() - ageDays * DAY - 3600_000) } });
  }
});
afterAll(() => prisma.$disconnect());

describe("scope", () => {
  it("management sees all; the owning team agent sees its tickets; other teams and vendors see none", async () => {
    expect((await getOverview(await actor("mia"), f())).kpis.total).toBe(5);
    expect((await getOverview(await actor("andy"), f())).kpis.total).toBe(5);
    expect((await getOverview(await actor("ana"), f())).kpis.total).toBe(0);
    expect((await getOverview(await actor("vendorA"), f())).kpis.total).toBe(0);
  });
  it("employees cannot use dashboards", async () => {
    await expect(getOverview(await actor("emma"), f())).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("filters & breakdowns", () => {
  it("priority, branch, team and date range narrow the counts", async () => {
    const mia = await actor("mia");
    const o = await getOverview(mia, f());
    expect(o.byPriority.find((p) => p.name.startsWith("P3"))?.count).toBe(2);
    expect(o.byTeam).toEqual([expect.objectContaining({ id: teamId, count: 5 })]);
    const p3 = (await prisma.priority.findUniqueOrThrow({ where: { code: "P3" } })).id;
    expect((await getOverview(mia, f({ priority: p3 }))).kpis.total).toBe(2);
    expect((await getOverview(mia, f({ branch: cnx }))).kpis.total).toBe(1);
    expect((await getOverview(mia, f({ range: "7d" }))).kpis.total).toBe(3);
    const from = new Date(Date.now() - 11 * DAY).toISOString().slice(0, 10), to = new Date(Date.now() - 9 * DAY).toISOString().slice(0, 10);
    expect((await getOverview(mia, f({ range: "custom", from, to }))).kpis.total).toBe(1);
  });
  it("trend granularity follows the range", async () => {
    const mia = await actor("mia");
    expect((await getOverview(mia, f({ range: "30d" }))).window.granularity).toBe("day");
    const year = await getOverview(mia, f({ range: "365d" }));
    expect(year.window.granularity).toBe("week");
    expect(year.trend.reduce((a, t) => a + t.created, 0)).toBe(5);
  });
});

describe("aging", () => {
  it("puts open tickets into the five buckets", async () => {
    const a = await getAging(await actor("mia"), f());
    expect(Object.fromEntries(a.buckets.map((b) => [b.key, b.total]))).toEqual({ "0-1": 1, "2-3": 1, "4-7": 1, "8-14": 1, "15+": 1 });
    expect(a.oldest[0]?.ageDays).toBe(20);
    expect(a.buckets.find((b) => b.key === "8-14")?.byPriority).toEqual({ P3: 1 });
  });
});

describe("workload & SLA performance", () => {
  it("agent workload counts tickets, tasks, overdue tasks and completions", async () => {
    const admin = await actor("admin");
    const andy = await actor("andy");
    await assignTicket(admin, { ticketId: ids.t5!, agentId: andy.id });
    await assignTicket(admin, { ticketId: ids.t10!, agentId: andy.id });
    await createTask(admin, ids.t5!, { title: "Analytics overdue task", teamId, agentId: andy.id, dueDate: new Date(Date.now() - 3600_000).toISOString() });
    const status = async (c: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code: c } })).id;
    await changeTicketStatus(andy, { ticketId: ids.t10!, toStatusId: await status("IN_PROGRESS") });
    await changeTicketStatus(andy, { ticketId: ids.t10!, toStatusId: await status("RESOLVED"), resolutionSummary: "Done" });
    const w = await getWorkload(admin, f({ team: teamId }));
    expect(w.agents).toEqual([expect.objectContaining({ name: "Andy Analyst", assigned: 1, openTasks: 1, overdueTasks: 1, completed: 1 })]);
    expect(w.teams).toEqual([expect.objectContaining({ teamId, open: 4, unassigned: 3, completed: 1 })]);
  });
  it("SLA compliance by priority follows the breach flags", async () => {
    const mia = await actor("mia");
    let s = await getSlaPerformance(mia, f());
    expect(s.byPriority.find((p) => p.name.startsWith("P3"))).toMatchObject({ total: 1, breached: 1, compliance: 0 }); // 10-day-old P3 resolved late
    await prisma.ticket.update({ where: { id: ids.t10! }, data: { resolutionBreached: false } });
    s = await getSlaPerformance(mia, f());
    expect(s.byPriority.find((p) => p.name.startsWith("P3"))?.compliance).toBe(100);
    expect(s.openStates.ON_TRACK + s.openStates.WARNING + s.openStates.BREACHED + s.openStates.PAUSED + s.openStates.NONE).toBe(4);
  });
});

describe("reports", () => {
  it("require report.export and respect scope", async () => {
    await expect(runReport(await actor("ana"), "tickets", f())).rejects.toBeInstanceOf(AuthorizationError);
    expect((await runReport(await actor("lee"), "tickets", f())).rows).toHaveLength(0); // IT Support lead: not his team
    const r = await runReport(await actor("admin"), "tickets", f());
    expect(r.rows).toHaveLength(5);
    expect(r.headers).not.toContain("Description");
  });
  it("CSV output escapes formulas and never contains chat content", async () => {
    await postMessage(await actor("emma"), ids.t0!, { body: "SECRET-CHAT-CONTENT do not export" });
    const admin = await actor("admin");
    for (const type of ["tickets", "sla", "agents", "teams", "categories"]) {
      const r = await runReport(admin, type, f());
      const csv = toCsv(r.headers, r.rows);
      expect(csv).not.toContain("SECRET-CHAT-CONTENT");
      if (type === "tickets") expect(csv).toContain(`"'=HYPERLINK(""http://evil"") analytics"`);
    }
    await expect(runReport(admin, "nope", f())).rejects.toThrow(/Unknown report/);
  });
});

describe("seed upgrades", () => {
  it("grants newly introduced permission codes to existing system roles", async () => {
    await prisma.permission.delete({ where: { code: "report.export" } }); // simulate a database seeded before Phase 5
    execSync("npx tsx prisma/seed.ts", { stdio: "pipe", env: process.env });
    const lead = await prisma.role.findUniqueOrThrow({ where: { code: "TEAM_LEAD" }, include: { permissions: { include: { permission: true } } } });
    expect(lead.permissions.map((p) => p.permission.code)).toContain("report.export");
    const agent = await prisma.role.findUniqueOrThrow({ where: { code: "SUPPORT_AGENT" }, include: { permissions: { include: { permission: true } } } });
    expect(agent.permissions.map((p) => p.permission.code)).not.toContain("report.export");
  });
});
