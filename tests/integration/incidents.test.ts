import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { assignTicket, changeTicketStatus, createTicket } from "@/server/services/tickets";
import {
  activeIncidentsFor, declareMajorIncident, getIncidentPanel, linkToIncident, listMajorIncidents, postIncidentUpdate,
  reportAffected, resolveMajorIncident, setImpact, unlinkFromIncident,
} from "@/server/services/incidents";
import { createTask } from "@/server/services/tasks";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";

const E = {
  emma: "emma@contoso.example", ethan: "ethan@contoso.example", somchai: "somchai@contoso.example", fiona: "fiona@fabrikam.example",
  agent: "ana.agent@contoso.example", lead: "lee.lead@contoso.example", admin: "sys.admin@contoso.example", vendorA: "victor@vendor-a.example", mia: "mia.manager@contoso.example",
};
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  return (await loadActor(prisma, u.id))!;
}
const cat = async (c: string) => (await prisma.category.findUniqueOrThrow({ where: { code: c } })).id;
const status = async (c: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code: c } })).id;
const branch = async (c: string) => (await prisma.branch.findFirstOrThrow({ where: { code: c } })).id;

async function newTicket(who: keyof typeof E, subject: string, extra: Record<string, unknown> = {}) {
  return createTicket(await actor(who), { subject, description: "Incident integration test body.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW"), ...extra });
}
async function inProgress(ticketId: string) {
  const lead = await actor("lead");
  const ana = await actor("agent");
  await assignTicket(lead, { ticketId, agentId: ana.id });
  await changeTicketStatus(ana, { ticketId, toStatusId: await status("IN_PROGRESS") });
}
/** Builds an active major incident impacting BKK01 + CNX01. */
async function majorIncident(subject = `Store network outage ${Math.random().toString(36).slice(2, 7)}`) {
  const t = await newTicket("emma", subject);
  const lead = await actor("lead");
  await setImpact(lead, t.id, { impactScope: "MULTIPLE_BRANCHES", branchIds: [await branch("BKK01"), await branch("CNX01")], impactedUserCount: "40" });
  await declareMajorIncident(lead, t.id, { message: "Stores cannot reach the ERP. Investigating." });
  return t;
}
afterAll(() => prisma.$disconnect());

describe("impact", () => {
  it("validates scope vs branches and records history + audit", async () => {
    const t = await newTicket("emma", "Impact validation ticket");
    const ana = await actor("agent");
    await expect(setImpact(ana, t.id, { impactScope: "MULTIPLE_BRANCHES", branchIds: [await branch("BKK01")] })).rejects.toThrow(/at least two/);
    await expect(setImpact(ana, t.id, { impactScope: "SINGLE_BRANCH", branchIds: ["nope"] })).rejects.toThrow(/Unknown branch/);
    await setImpact(ana, t.id, { impactScope: "SINGLE_BRANCH", branchIds: [await branch("BKK01")], impactedUserCount: "5" });
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, include: { impactedBranches: true } });
    expect(row.impactScope).toBe("SINGLE_BRANCH");
    expect(row.impactedUserCount).toBe(5);
    expect(row.impactedBranches).toHaveLength(1);
    expect(await prisma.ticketHistory.count({ where: { ticketId: t.id, action: "IMPACT_CHANGED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { ticketId: t.id, action: "IMPACT_CHANGED" } })).toBe(1);
  });

  it("requester, other employees and vendors cannot set impact", async () => {
    const t = await newTicket("emma", "Impact permission ticket");
    await expect(setImpact(await actor("emma"), t.id, { impactScope: "COMPANY_WIDE" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setImpact(await actor("fiona"), t.id, { impactScope: "COMPANY_WIDE" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setImpact(await actor("vendorA"), t.id, { impactScope: "COMPANY_WIDE" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("accepts impact on create (single branch defaults to the ticket branch)", async () => {
    const t = await newTicket("emma", "Impact on create", { impactScope: "SINGLE_BRANCH" });
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, include: { impactedBranches: true } });
    expect(row.impactScope).toBe("SINGLE_BRANCH");
    expect(row.impactedBranches.map((b) => b.branchId)).toEqual([await branch("BKK01")]);
    await expect(newTicket("emma", "Bad impact on create", { impactScope: "MULTIPLE_BRANCHES", impactBranchIds: [await branch("HQ")] }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe("major incident lifecycle", () => {
  it("only incident managers can declare; requires impact; not twice", async () => {
    const t = await newTicket("emma", "Declare rules ticket");
    await expect(declareMajorIncident(await actor("agent"), t.id, { message: "Big outage now" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(declareMajorIncident(await actor("lead"), t.id, { message: "Big outage now" })).rejects.toThrow(/Set the impact/);
    await setImpact(await actor("lead"), t.id, { impactScope: "COMPANY_WIDE" });
    await declareMajorIncident(await actor("lead"), t.id, { message: "Big outage now" });
    await expect(declareMajorIncident(await actor("lead"), t.id, { message: "Big outage now" })).rejects.toThrow(/already/);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ isMajorIncident: true, majorIncidentStatus: "INVESTIGATING" });
    expect(await prisma.auditLog.count({ where: { ticketId: t.id, action: "MAJOR_INCIDENT_DECLARED" } })).toBe(1);
  });

  it("confidential tickets cannot be declared", async () => {
    const t = await newTicket("emma", "Confidential incident", { isConfidential: "on" });
    await setImpact(await actor("lead"), t.id, { impactScope: "SINGLE_USER" });
    await expect(declareMajorIncident(await actor("lead"), t.id, { message: "Should fail here" })).rejects.toThrow(/Confidential/);
  });

  it("declare notifies owner team staff and requester; updates notify linked requesters", async () => {
    const t = await majorIncident();
    const lead = await actor("lead");
    const ana = await actor("agent");
    const somchaiTicket = await newTicket("somchai", "POS at Siam cannot reach ERP");
    await linkToIncident(lead, t.id, somchaiTicket.number);
    const somchai = await actor("somchai");
    expect(await prisma.notification.count({ where: { userId: ana.id, ticketId: t.id, type: "MAJOR_INCIDENT" } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { userId: (await actor("emma")).id, ticketId: t.id, type: "MAJOR_INCIDENT" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: somchai.id, ticketId: somchaiTicket.id, type: "MAJOR_INCIDENT" } })).toBe(1);

    await postIncidentUpdate(lead, t.id, { status: "IDENTIFIED", message: "Core switch failure at DC, replacing." });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).majorIncidentStatus).toBe("IDENTIFIED");
    expect(await prisma.notification.count({ where: { userId: somchai.id, ticketId: t.id, type: "MAJOR_INCIDENT" } })).toBe(1);
    expect(await prisma.incidentUpdate.count({ where: { ticketId: t.id } })).toBe(2);
    await expect(postIncidentUpdate(ana, t.id, { status: "MONITORING", message: "not allowed" })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("linking rules prevent cycles, self-links and double links", async () => {
    const a = await majorIncident();
    const b = await majorIncident();
    const lead = await actor("lead");
    await expect(linkToIncident(lead, a.id, a.number)).rejects.toThrow(/itself/);
    await expect(linkToIncident(lead, a.id, b.number)).rejects.toThrow(/major incident/);
    const c = await newTicket("emma", "Child ticket for link rules");
    await linkToIncident(lead, a.id, c.number);
    await expect(linkToIncident(lead, a.id, c.number)).rejects.toThrow(/Already linked/);
    await expect(linkToIncident(lead, b.id, c.number)).rejects.toThrow(/another incident/);
    // A ticket that has children cannot become a child, and a child cannot be declared.
    await setImpact(lead, c.id, { impactScope: "SINGLE_USER" });
    await expect(declareMajorIncident(lead, c.id, { message: "child declare attempt" })).rejects.toThrow(/linked to another incident/);
    await unlinkFromIncident(lead, c.number);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: c.id } })).parentIncidentId).toBeNull();
    const plain = await newTicket("emma", "Not an incident");
    await expect(linkToIncident(lead, plain.id, c.number)).rejects.toThrow(/active major incident/);
  });

  it("resolve with cascade resolves eligible children and reports skipped ones", async () => {
    const t = await majorIncident();
    const lead = await actor("lead");
    const eligible = await newTicket("somchai", "Cascade eligible child");
    await inProgress(eligible.id);
    const newOne = await newTicket("ethan", "Cascade child still new");
    const blocked = await newTicket("emma", "Cascade child with required task");
    await inProgress(blocked.id);
    await createTask(lead, blocked.id, { title: "Replace switch", teamId: (await prisma.supportTeam.findUniqueOrThrow({ where: { code: "INFRA" } })).id, isRequired: "on" });
    for (const c of [eligible, newOne, blocked]) await linkToIncident(lead, t.id, c.number);

    await expect(resolveMajorIncident(await actor("agent"), t.id, { summary: "Fixed now ok" })).rejects.toBeInstanceOf(AuthorizationError);
    const r = await resolveMajorIncident(lead, t.id, { summary: "Core switch replaced, stores online.", cascade: "on" });
    expect(r.resolved).toEqual([eligible.number]);
    expect(r.skipped.map((s) => s.number).sort()).toEqual([newOne.number, blocked.number].sort());
    expect(r.skipped.find((s) => s.number === blocked.number)!.reason).toMatch(/required tasks/);

    const e = await prisma.ticket.findUniqueOrThrow({ where: { id: eligible.id }, include: { status: true } });
    expect(e.status.kind).toBe("RESOLVED");
    expect(e.resolutionSummary).toBe("Core switch replaced, stores online.");
    expect(e.resolvedAt).not.toBeNull();
    expect(await prisma.ticketHistory.count({ where: { ticketId: eligible.id, action: "STATUS_CHANGED", reason: { contains: t.number } } })).toBe(1);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).majorIncidentStatus).toBe("RESOLVED");
    await expect(postIncidentUpdate(lead, t.id, { status: "MONITORING", message: "after resolve" })).rejects.toThrow(/not an active/);
  });
});

describe("known-issue banner and self-report", () => {
  it("shows active incidents only to users of impacted branches / company", async () => {
    const t = await majorIncident("Banner visibility outage");
    const ids = async (k: keyof typeof E) => (await activeIncidentsFor(await actor(k))).map((i) => i.id);
    expect(await ids("somchai")).toContain(t.id); // BKK01
    expect(await ids("ethan")).toContain(t.id);   // CNX01
    expect(await ids("mia")).not.toContain(t.id); // HQ
    expect(await ids("fiona")).not.toContain(t.id); // other company
    const banner = (await activeIncidentsFor(await actor("somchai"))).find((i) => i.id === t.id)!;
    expect(banner.latest?.message).toMatch(/Investigating/);
    expect(Object.keys(banner)).not.toContain("description");
  });

  it("company-wide incidents reach every user of that company only", async () => {
    const t = await newTicket("emma", `Company-wide email outage ${Date.now()}`);
    await setImpact(await actor("lead"), t.id, { impactScope: "COMPANY_WIDE" });
    await declareMajorIncident(await actor("lead"), t.id, { message: "Email down for everyone" });
    expect((await activeIncidentsFor(await actor("mia"))).map((i) => i.id)).toContain(t.id);
    expect((await activeIncidentsFor(await actor("fiona"))).map((i) => i.id)).not.toContain(t.id);
  });

  it("I'm affected too creates one linked child ticket per user; outsiders refused", async () => {
    const t = await majorIncident("Self-report outage");
    const child = await reportAffected(await actor("somchai"), t.id, {});
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: child.id } });
    expect(row.parentIncidentId).toBe(t.id);
    expect(row.subject).toMatch(/Affected by/);
    await expect(reportAffected(await actor("somchai"), t.id, {})).rejects.toThrow(/already reported/);
    await expect(reportAffected(await actor("mia"), t.id, {})).rejects.toBeInstanceOf(NotFoundError);
    const banner = (await activeIncidentsFor(await actor("somchai"))).find((i) => i.id === t.id)!;
    expect(banner.myTicket).toBe(child.number);
  });
});

describe("read models", () => {
  it("dashboard lists incidents with branch counts; employees refused; panel flags", async () => {
    const t = await majorIncident("Dashboard outage");
    const list = await listMajorIncidents(await actor("mia"));
    expect(list.rows.map((r) => r.id)).toContain(t.id);
    expect(list.impactedBranches.find((b) => b.name.includes("Siam"))!.count).toBeGreaterThan(0);
    await expect(listMajorIncidents(await actor("emma"))).rejects.toBeInstanceOf(AuthorizationError);
    const leadPanel = await getIncidentPanel(await actor("lead"), t.id);
    expect(leadPanel).toMatchObject({ canManage: true, canDeclare: false, canSetImpact: true });
    const anaPanel = await getIncidentPanel(await actor("agent"), t.id);
    expect(anaPanel).toMatchObject({ canManage: false, canSetImpact: true });
    const emmaPanel = await getIncidentPanel(await actor("emma"), t.id);
    expect(emmaPanel).toMatchObject({ canManage: false, canSetImpact: false });
  });
});
