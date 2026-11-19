import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { assignTicket, changeTicketStatus, createTicket, getTicketDetail, readAttachment } from "@/server/services/tickets";
import {
  addTaskAttachments, assignTask, changeTaskStatus, createTask, getTicketTasks, listTasks, taskListQuerySchema, updateTask,
} from "@/server/services/tasks";
import { addSupportingTeam, escalateTicket, removeSupportingTeam, updateTicketFields } from "@/server/services/ticket-updates";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";

const E = {
  somchai: "somchai@contoso.example", emma: "emma@contoso.example", retail: "rita.retail@contoso.example", infra: "ivan.infra@contoso.example",
  agent: "ana.agent@contoso.example", lead: "lee.lead@contoso.example", erp: "erin.erp@contoso.example", vendorA: "victor@vendor-a.example",
  vendorB: "vera@vendor-b.example", admin: "sys.admin@contoso.example",
};
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  const a = await loadActor(prisma, u.id);
  if (!a) throw new Error(`${k} inactive`);
  return a;
}
const id = {
  team: async (code: string) => (await prisma.supportTeam.findUniqueOrThrow({ where: { code } })).id,
  cat: async (code: string) => (await prisma.category.findUniqueOrThrow({ where: { code } })).id,
  status: async (code: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code } })).id,
  prio: async (code: string) => (await prisma.priority.findUniqueOrThrow({ where: { code } })).id,
};
const year = new Date().getFullYear();

let ticket: { id: string; number: string };
let netTask: { id: string; number: string };
let payTask: { id: string; number: string };

beforeAll(async () => {
  const rita = await actor("retail");
  ticket = await createTicket(await actor("somchai"), {
    subject: "Branch POS cannot operate", description: "All POS terminals are offline since opening time.",
    categoryId: await id.cat("RTL"), subcategoryId: await id.cat("RTL-POS"), relatedAsset: "POS-ALL", contactNumber: "+66 1",
  });
  await assignTicket(rita, { ticketId: ticket.id, agentId: rita.id });
});
afterAll(() => prisma.$disconnect());

describe("task creation & multi-team collaboration", () => {
  it("creates numbered tasks and adds other teams as supporting teams", async () => {
    const rita = await actor("retail");
    netTask = await createTask(rita, ticket.id, { title: "Network investigation", teamId: await id.team("INFRA"), dueDate: new Date(Date.now() - 3600_000).toISOString() });
    payTask = await createTask(rita, ticket.id, { title: "Payment terminal investigation", teamId: await id.team("VENDOR-B") });
    await createTask(rita, ticket.id, { title: "POS troubleshooting", teamId: await id.team("RETAIL"), agentId: rita.id, isRequired: "false" });
    expect(netTask.number).toMatch(new RegExp(`^TSK-${year}-\\d{6}$`));
    const sup = await prisma.ticketSupportingTeam.findMany({ where: { ticketId: ticket.id }, include: { team: true } });
    expect(sup.map((s) => s.team.code).sort()).toEqual(["INFRA", "VENDOR-B"]); // owner team RETAIL not duplicated
    const t = await prisma.ticketTask.findUniqueOrThrow({ where: { id: netTask.id }, include: { history: true, assignments: true } });
    expect(t.status).toBe("OPEN");
    expect(t.history[0]?.action).toBe("CREATED");
    expect(t.assignments).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: netTask.id, action: "TASK_CREATED" } })).toBe(1);
    const infraLead = await actor("infra");
    expect(await prisma.notification.count({ where: { userId: infraLead.id, type: "TASK_CREATED", ticketId: ticket.id } })).toBe(1);
  });
  it("employees and unrelated agents cannot create tasks", async () => {
    await expect(createTask(await actor("somchai"), ticket.id, { title: "Hack", teamId: await id.team("INFRA") })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createTask(await actor("erp"), ticket.id, { title: "Hack", teamId: await id.team("ERP") })).rejects.toBeInstanceOf(NotFoundError);
  });
  it("assigning another agent on create needs task.assign", async () => {
    const infraLead = await actor("infra");
    // Ana (agent, IT Support) cannot see this ticket at all; use Rita (agent) assigning Ivan.
    await expect(createTask(await actor("retail"), ticket.id, { title: "Assign other", teamId: await id.team("INFRA"), agentId: infraLead.id }))
      .rejects.toBeInstanceOf(AuthorizationError);
  });
  it("supporting-team members can see the ticket; vendor B sees only its own task", async () => {
    const infraLead = await actor("infra");
    expect((await getTicketDetail(infraLead, ticket.number)).ticket.id).toBe(ticket.id);
    const vera = await actor("vendorB");
    const detail = await getTicketDetail(vera, ticket.number);
    const tasks = await getTicketTasks(vera, detail.ticket);
    expect(tasks.tasks.map((t) => t.number)).toEqual([payTask.number]);
    expect(tasks.hiddenCount).toBe(2);
    expect(tasks.progress.total).toBe(3);
    // timeline hides other teams' task events from the vendor
    expect(detail.timeline.some((h) => h.action.startsWith("TASK_") && h.newValue?.includes(netTask.number))).toBe(false);
    // other vendors see nothing
    await expect(getTicketDetail(await actor("vendorA"), ticket.number)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("requester sees tasks read-only", async () => {
    const s = await actor("somchai");
    const detail = await getTicketDetail(s, ticket.number);
    const tasks = await getTicketTasks(s, detail.ticket);
    expect(tasks.tasks).toHaveLength(3);
    expect(tasks.tasks.every((t) => !t.perm.canWork && !t.perm.canChangeStatus && !t.perm.canAssign)).toBe(true);
    await expect(changeTaskStatus(s, netTask.id, { status: "IN_PROGRESS" })).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("task assignment & status", () => {
  it("agents can only self-assign within their team; non-members are rejected", async () => {
    const ana = await actor("agent");
    const infraLead = await actor("infra");
    await expect(assignTask(infraLead, netTask.id, { agentId: ana.id })).rejects.toThrow(/not an active member/);
    await assignTask(infraLead, netTask.id, { agentId: infraLead.id });
    const t = await prisma.ticketTask.findUniqueOrThrow({ where: { id: netTask.id }, include: { assignments: { orderBy: { createdAt: "desc" } } } });
    expect(t.status).toBe("ASSIGNED");
    expect(t.assignments[0]).toMatchObject({ agentId: infraLead.id, changedById: infraLead.id });
    expect(await prisma.auditLog.count({ where: { entityId: netTask.id, action: "TASK_ASSIGNED" } })).toBe(1);
  });
  it("vendor works its own task but cannot touch others", async () => {
    const vera = await actor("vendorB");
    await assignTask(vera, payTask.id, { agentId: vera.id });
    await changeTaskStatus(vera, payTask.id, { status: "IN_PROGRESS" });
    await expect(changeTaskStatus(vera, netTask.id, { status: "IN_PROGRESS" })).rejects.toBeInstanceOf(NotFoundError);
  });
  it("agents cannot move tasks between teams; admins must give a reason", async () => {
    const rita = await actor("retail");
    await expect(assignTask(rita, payTask.id, { teamId: await id.team("VENDOR-A"), reason: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(assignTask(await actor("admin"), payTask.id, { teamId: await id.team("VENDOR-A") })).rejects.toThrow(/reason is required/);
  });
  it("waiting requires a reason; vendor can't reopen", async () => {
    const vera = await actor("vendorB");
    await expect(changeTaskStatus(vera, payTask.id, { status: "WAITING" })).rejects.toThrow(/reason is required/);
    await changeTaskStatus(vera, payTask.id, { status: "COMPLETED" });
    await expect(changeTaskStatus(vera, payTask.id, { status: "IN_PROGRESS" })).rejects.toThrow(/owning team/);
  });
  it("task attachments are visible only to those who can see the task", async () => {
    const vera = await actor("vendorB");
    await changeTaskStatus(await actor("retail"), payTask.id, { status: "IN_PROGRESS", reason: "Reopened for evidence" });
    await addTaskAttachments(vera, payTask.id, [{ name: "terminal.log", size: 6, data: Buffer.from("EDC ok") }]);
    const att = await prisma.ticketAttachment.findFirstOrThrow({ where: { taskId: payTask.id } });
    expect((await readAttachment(vera, att.id)).data.toString()).toBe("EDC ok");
    expect((await readAttachment(await actor("retail"), att.id)).att.id).toBe(att.id);
    // Infra lead sees the ticket but vendor attachments of other tasks are still visible to internal staff
    expect((await readAttachment(await actor("infra"), att.id)).att.id).toBe(att.id);
    const detail = await getTicketDetail(vera, ticket.number);
    expect(detail.ticket.attachments.some((a) => a.id === att.id)).toBe(false); // ticket-level list excludes task files
    await changeTaskStatus(vera, payTask.id, { status: "COMPLETED" });
  });
  it("only owner side may flip the required flag", async () => {
    const infraLead = await actor("infra");
    const t = await prisma.ticketTask.findUniqueOrThrow({ where: { id: netTask.id } });
    await expect(updateTask(infraLead, netTask.id, { title: t.title, isRequired: "false", dueDate: "", startDate: "", priorityId: "" }))
      .rejects.toBeInstanceOf(AuthorizationError);
    await updateTask(infraLead, netTask.id, { title: "Network investigation (router + VPN)", isRequired: "true", dueDate: "", startDate: "", priorityId: await id.prio("P1") });
    const h = await prisma.taskHistory.findMany({ where: { taskId: netTask.id, action: "FIELD_UPDATED" } });
    expect(h.map((x) => x.field).sort()).toEqual(["dueDate", "priority", "title"]);
  });
});

describe("resolution gating & task lists", () => {
  it("required open tasks block resolution; optional ones do not", async () => {
    const rita = await actor("retail");
    await changeTicketStatus(rita, { ticketId: ticket.id, toStatusId: await id.status("IN_PROGRESS") });
    await expect(changeTicketStatus(rita, { ticketId: ticket.id, toStatusId: await id.status("RESOLVED"), resolutionSummary: "Fixed" }))
      .rejects.toThrow(/required task/);
    const detail = await getTicketDetail(rita, ticket.number);
    expect(detail.blockingTasks.map((b) => b.number)).toEqual([netTask.number]);
  });
  it("lists: my / team / overdue / all honour scope", async () => {
    const infraLead = await actor("infra");
    const my = await listTasks(infraLead, "my", taskListQuerySchema.parse({}));
    expect(my.rows.map((r) => r.number)).toContain(netTask.number);
    const team = await listTasks(infraLead, "team", taskListQuerySchema.parse({}));
    expect(team.rows.every((r) => r.team?.id === infraLead.teamIds[0])).toBe(true);
    const vera = await actor("vendorB");
    const vAll = await listTasks(vera, "overdue", taskListQuerySchema.parse({}));
    expect(vAll.rows.every((r) => r.teamId && vera.teamIds.includes(r.teamId))).toBe(true);
    await expect(listTasks(vera, "all", taskListQuerySchema.parse({}))).rejects.toBeInstanceOf(AuthorizationError);
    const admin = await listTasks(await actor("admin"), "all", taskListQuerySchema.parse({ q: ticket.number }));
    expect(admin.total).toBe(3);
  });
  it("completing the last required task notifies and unblocks resolution", async () => {
    const infraLead = await actor("infra");
    const rita = await actor("retail");
    await changeTaskStatus(infraLead, netTask.id, { status: "IN_PROGRESS" });
    await changeTaskStatus(infraLead, netTask.id, { status: "COMPLETED" });
    expect(await prisma.notification.count({ where: { userId: rita.id, title: { contains: "All required tasks completed" } } })).toBe(1);
    await changeTicketStatus(rita, { ticketId: ticket.id, toStatusId: await id.status("RESOLVED"), resolutionSummary: "Router + VPN fixed" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).resolvedAt).not.toBeNull();
  });
  it("tasks of closed tickets are frozen", async () => {
    const s = await actor("somchai");
    await changeTicketStatus(s, { ticketId: ticket.id, toStatusId: await id.status("CLOSED") });
    await expect(createTask(await actor("retail"), ticket.id, { title: "Late task", teamId: await id.team("RETAIL") })).rejects.toThrow(/closed/);
  });
});

describe("ticket edits, supporting teams & escalation", () => {
  let t2: { id: string; number: string };
  beforeAll(async () => {
    t2 = await createTicket(await actor("emma"), {
      subject: "Laptop very slow", description: "Laptop takes 10 minutes to boot.", categoryId: await id.cat("HW"), subcategoryId: await id.cat("HW-NB"), relatedAsset: "NB-9",
    });
  });
  it("edits record per-field history, audit and SLA recalculation", async () => {
    const ana = await actor("agent");
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: t2.id } });
    await updateTicketFields(ana, t2.id, {
      subject: "Laptop very slow after update", description: before.description, categoryId: await id.cat("HW"), subcategoryId: await id.cat("HW-NB"),
      priorityId: await id.prio("P1"), relatedAsset: "NB-9", isConfidential: "", reason: "VIP user",
      branchId: before.branchId, locationId: before.locationId, contactNumber: before.contactNumber,
    });
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t2.id } });
    expect(after.resolutionDueAt!.getTime()).toBeLessThan(before.resolutionDueAt!.getTime());
    const h = await prisma.ticketHistory.findMany({ where: { ticketId: t2.id, action: { in: ["FIELD_UPDATED", "PRIORITY_CHANGED"] } } });
    expect(h.map((x) => x.action).sort()).toEqual(["FIELD_UPDATED", "PRIORITY_CHANGED"]);
    expect(await prisma.auditLog.count({ where: { ticketId: t2.id, action: "PRIORITY_CHANGED" } })).toBe(1);
    await expect(updateTicketFields(await actor("emma"), t2.id, { subject: "x".repeat(10), description: "y".repeat(20), categoryId: await id.cat("HW"), priorityId: await id.prio("P1") }))
      .rejects.toBeInstanceOf(AuthorizationError);
  });
  it("category change enforces required fields", async () => {
    const ana = await actor("agent");
    await expect(updateTicketFields(ana, t2.id, {
      subject: "Laptop very slow after update", description: "Laptop takes 10 minutes to boot.", categoryId: await id.cat("RTL"), subcategoryId: await id.cat("RTL-POS"),
      priorityId: await id.prio("P1"), relatedAsset: "NB-9",
    })).rejects.toMatchObject({ fieldErrors: { contactNumber: expect.any(String) } });
  });
  it("supporting team cannot be removed while it has open tasks", async () => {
    const lee = await actor("lead");
    await addSupportingTeam(lee, t2.id, await id.team("M365"));
    await expect(addSupportingTeam(lee, t2.id, await id.team("M365"))).rejects.toBeInstanceOf(ValidationError);
    await createTask(lee, t2.id, { title: "Check Intune policy", teamId: await id.team("M365") });
    await expect(removeSupportingTeam(lee, t2.id, await id.team("M365"))).rejects.toThrow(/open task/);
    await expect(addSupportingTeam(await actor("agent"), t2.id, await id.team("ERP"))).resolves.toBeUndefined(); // agent has ticket.assign within own team
  });
  it("escalation requires ticket.escalate and only raises priority", async () => {
    await expect(escalateTicket(await actor("agent"), t2.id, { reason: "Need help" })).rejects.toBeInstanceOf(AuthorizationError);
    const lee = await actor("lead");
    await expect(escalateTicket(lee, t2.id, { priorityId: await id.prio("P4"), reason: "lower it" })).rejects.toThrow(/only raise/);
    await escalateTicket(lee, t2.id, { teamId: await id.team("INFRA"), reason: "Suspected disk failure on fleet" });
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: t2.id }, include: { ownerTeam: true, assignments: { orderBy: { createdAt: "desc" } } } });
    expect(t.ownerTeam?.code).toBe("INFRA");
    expect(t.assignments[0]?.type).toBe("ESCALATE");
    const infraLead = await actor("infra");
    expect(await prisma.notification.count({ where: { userId: infraLead.id, type: "TICKET_ESCALATED" } })).toBe(1);
  });
});
