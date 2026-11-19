import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { assignTicket, changeTicketStatus, createTicket, getTicketDetail } from "@/server/services/tickets";
import { decideApproval, deletePolicy, myApprovals, savePolicy } from "@/server/services/approvals";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";

const E = {
  emma: "emma@contoso.example", ethan: "ethan@contoso.example", somchai: "somchai@contoso.example", mia: "mia.manager@contoso.example",
  agent: "ana.agent@contoso.example", lead: "lee.lead@contoso.example", admin: "sys.admin@contoso.example", fiona: "fiona@fabrikam.example",
};
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  return (await loadActor(prisma, u.id))!;
}
const cat = async (c: string) => (await prisma.category.findUniqueOrThrow({ where: { code: c } })).id;
const status = async (c: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code: c } })).id;
const MIN = 60_000;

async function hwRequest(who: keyof typeof E = "emma", subject = "Need a second monitor for month-end") {
  return createTicket(await actor(who), { subject, description: "Approval integration test request body.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-HW") });
}
const approvals = (ticketId: string) => prisma.ticketApproval.findMany({ where: { ticketId }, orderBy: { stepOrder: "asc" } });
const ticket = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id }, include: { status: true } });
afterAll(() => prisma.$disconnect());

describe("approval on create", () => {
  it("matches the subcategory policy, routes to the requester's manager and pauses the SLA", async () => {
    const t = await hwRequest();
    const row = await ticket(t.id);
    expect(row.approvalStatus).toBe("PENDING");
    expect(row.slaPausedAt).not.toBeNull();
    const [a] = await approvals(t.id);
    expect(a).toMatchObject({ decision: "PENDING", approverId: (await actor("ethan")).id, stepName: "Line manager approval" });
    expect(await prisma.slaEvent.count({ where: { ticketId: t.id, type: "PAUSED", detail: "approval" } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: (await actor("ethan")).id, ticketId: t.id, type: "APPROVAL_REQUESTED" } })).toBe(1);
  });

  it("uses the fallback approver when the requester has no manager", async () => {
    const t = await hwRequest("somchai", "Barcode printer for the stock room");
    expect((await approvals(t.id))[0]!.approverId).toBe((await actor("admin")).id);
  });

  it("does not apply to categories without a policy", async () => {
    const t = await createTicket(await actor("emma"), { subject: "Install Power BI please", description: "No approval needed here.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW") });
    expect((await ticket(t.id)).approvalStatus).toBe("NOT_REQUIRED");
  });
});

describe("gate while pending", () => {
  it("blocks progress (but allows assignment and cancellation)", async () => {
    const t = await hwRequest();
    const lead = await actor("lead");
    const ana = await actor("agent");
    await assignTicket(lead, { ticketId: t.id, agentId: ana.id });
    const row = await ticket(t.id);
    expect(row.assignedAgentId).toBe(ana.id);
    expect(row.status.kind).toBe("NEW"); // no auto-advance while pending
    expect(row.slaPausedAt).not.toBeNull(); // still paused
    await expect(changeTicketStatus(ana, { ticketId: t.id, toStatusId: await status("IN_PROGRESS") })).rejects.toThrow(/waiting for approval/);
    const detail = await getTicketDetail(ana, t.id);
    expect(detail.allowedTransitions.every((tr) => tr.kind === "CANCELLED")).toBe(true);
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await status("CANCELLED"), reason: "Duplicate request" });
    expect((await approvals(t.id)).map((a) => a.decision)).toEqual(["CANCELLED"]);
    expect((await myApprovals(await actor("ethan"))).pending.find((p) => p.ticket.id === t.id)).toBeUndefined();
  });
});

describe("decisions", () => {
  it("only the assigned approver can decide; rejection needs a comment", async () => {
    const t = await hwRequest();
    const [a] = await approvals(t.id);
    await expect(decideApproval(await actor("lead"), a!.id, { decision: "APPROVED" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideApproval(await actor("emma"), a!.id, { decision: "APPROVED" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideApproval(await actor("ethan"), a!.id, { decision: "REJECTED" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("approve resumes the SLA with the paused time added and lets the ticket progress", async () => {
    const t = await hwRequest();
    // Simulate 45 minutes waiting for approval.
    const before = await ticket(t.id);
    await prisma.ticket.update({ where: { id: t.id }, data: { slaPausedAt: new Date(before.slaPausedAt!.getTime() - 45 * MIN) } });
    const [a] = await approvals(t.id);
    expect(await decideApproval(await actor("ethan"), a!.id, { decision: "APPROVED", comment: "OK for month-end" })).toEqual({ status: "APPROVED" });
    const row = await ticket(t.id);
    expect(row.approvalStatus).toBe("APPROVED");
    expect(row.slaPausedAt).toBeNull();
    if (row.slaBusinessHours === false) expect(row.slaPausedMinutes).toBe(45);
    expect(await prisma.slaEvent.count({ where: { ticketId: t.id, type: "RESUMED" } })).toBeGreaterThan(0);
    await expect(decideApproval(await actor("ethan"), a!.id, { decision: "APPROVED" })).rejects.toThrow(/already/);

    const ana = await actor("agent");
    await assignTicket(await actor("lead"), { ticketId: t.id, agentId: ana.id });
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await status("IN_PROGRESS") });
    expect((await ticket(t.id)).status.code).toBe("IN_PROGRESS");
    expect(await prisma.notification.count({ where: { userId: (await actor("emma")).id, ticketId: t.id, type: "APPROVAL_DECIDED" } })).toBe(1);
  });

  it("reject cancels the ticket, records the reason and notifies the requester", async () => {
    const t = await hwRequest();
    const [a] = await approvals(t.id);
    await decideApproval(await actor("ethan"), a!.id, { decision: "REJECTED", comment: "Use the spare monitor in the store room" });
    const row = await ticket(t.id);
    expect(row.approvalStatus).toBe("REJECTED");
    expect(row.status.kind).toBe("CANCELLED");
    expect(await prisma.ticketHistory.count({ where: { ticketId: t.id, action: "APPROVAL_REJECTED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: (await actor("emma")).id, ticketId: t.id, type: "APPROVAL_DECIDED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { ticketId: t.id, action: "APPROVAL_REJECTED" } })).toBe(1);
  });
});

describe("multi-step policies and approver access", () => {
  it("runs steps in order and gives each approver read access only when it is their turn", async () => {
    const admin = await actor("admin");
    const mia = await actor("mia");
    // REQ-NEW: manager → Mia (specific user)
    const existing = await prisma.approvalPolicy.findFirstOrThrow({ where: { category: { code: "REQ-NEW" } } });
    await savePolicy(admin, existing.id, {
      name: "New equipment (2 steps)", categoryId: existing.categoryId, isActive: "on",
      steps: [{ name: "Manager", approverType: "REQUESTER_MANAGER", fallbackUserId: admin.id }, { name: "Management", approverType: "SPECIFIC_USER", approverUserId: mia.id }],
    });
    const t = await createTicket(await actor("emma"), { subject: "New laptop for intern", description: "Intern starts on Monday.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-NEW") });
    const [s1, s2] = await approvals(t.id);
    expect([s1!.decision, s2!.decision]).toEqual(["PENDING", "WAITING"]);
    // Mia (own tickets only) cannot see it yet.
    await expect(getTicketDetail(mia, t.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await decideApproval(await actor("ethan"), s1!.id, { decision: "APPROVED" })).toEqual({ status: "PENDING" });
    expect((await ticket(t.id)).approvalStatus).toBe("PENDING");
    // Now Mia sees it (read-only) and it is in her queue.
    expect((await getTicketDetail(mia, t.id)).ticket.number).toBe(t.number);
    expect((await myApprovals(mia)).pending.map((p) => p.ticket.id)).toContain(t.id);
    // ...but not other tickets.
    const other = await hwRequest();
    await expect(getTicketDetail(mia, other.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await decideApproval(mia, s2!.id, { decision: "APPROVED" })).toEqual({ status: "APPROVED" });
    // Fabrikam user never sees it.
    await expect(getTicketDetail(await actor("fiona"), t.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("policy administration", () => {
  it("requires admin.workflow, validates approvers and category uniqueness, audits, protects used policies", async () => {
    const admin = await actor("admin");
    await expect(savePolicy(await actor("lead"), null, {})).rejects.toBeInstanceOf(AuthorizationError);
    const hw = await cat("HW-PE");
    await expect(savePolicy(admin, null, { name: "Bad", categoryId: hw, steps: [{ name: "Step one", approverType: "SPECIFIC_USER" }] })).rejects.toThrow(/choose the approver/);
    const vendor = await prisma.user.findFirstOrThrow({ where: { email: "victor@vendor-a.example" } });
    await expect(savePolicy(admin, null, { name: "Vendor approver", categoryId: hw, steps: [{ name: "Step one", approverType: "SPECIFIC_USER", approverUserId: vendor.id }] })).rejects.toThrow(/internal users/);
    const p = await savePolicy(admin, null, { name: "Peripheral approval", categoryId: hw, isActive: "on", steps: [{ name: "Manager", approverType: "REQUESTER_MANAGER" }] });
    await expect(savePolicy(admin, null, { name: "Dup", categoryId: hw, steps: [{ name: "Manager", approverType: "REQUESTER_MANAGER" }] })).rejects.toThrow(/already has/);
    expect(await prisma.auditLog.count({ where: { entityId: p.id, action: "APPROVAL_POLICY_CREATED" } })).toBe(1);
    await deletePolicy(admin, p.id);
    const used = await prisma.approvalPolicy.findFirstOrThrow({ where: { category: { code: "REQ-HW" } } });
    await expect(deletePolicy(admin, used.id)).rejects.toThrow(/deactivate/);
  });

  it("a requester whose chain cannot be resolved gets a clear error and no ticket", async () => {
    const admin = await actor("admin");
    const acc = await prisma.approvalPolicy.findFirstOrThrow({ where: { category: { code: "REQ-ACC" } } });
    await savePolicy(admin, acc.id, { name: "Access (no fallback)", categoryId: acc.categoryId, isActive: "on", steps: [{ name: "Manager", approverType: "REQUESTER_MANAGER" }] });
    const before = await prisma.ticket.count();
    await expect(createTicket(await actor("somchai"), { subject: "Access to stock reports", description: "Need access to the stock reports.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-ACC") }))
      .rejects.toThrow(/No approver is available/);
    expect(await prisma.ticket.count()).toBe(before);
  });
});
