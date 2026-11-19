import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { assignTicket, changeTicketStatus, createTicket } from "@/server/services/tickets";
import { updateTicketFields } from "@/server/services/ticket-updates";
import { postMessage } from "@/server/services/messages";
import { createTask } from "@/server/services/tasks";
import { runSlaSweep } from "@/server/jobs/sla-sweep";
import { saveBusinessHours, saveSlaTargets, saveSystemSettings } from "@/server/services/admin/system";
import { ValidationError } from "@/server/authz/errors";

const E = { emma: "emma@contoso.example", agent: "ana.agent@contoso.example", lead: "lee.lead@contoso.example", admin: "sys.admin@contoso.example", infra: "ivan.infra@contoso.example" };
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  return (await loadActor(prisma, u.id))!;
}
const id = {
  cat: async (c: string) => (await prisma.category.findUniqueOrThrow({ where: { code: c } })).id,
  status: async (c: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code: c } })).id,
  prio: async (c: string) => (await prisma.priority.findUniqueOrThrow({ where: { code: c } })).id,
  team: async (c: string) => (await prisma.supportTeam.findUniqueOrThrow({ where: { code: c } })).id,
};
const MIN = 60_000;
async function newP1(subject: string) {
  return createTicket(await actor("emma"), {
    subject, description: "SLA integration test ticket body.", categoryId: await id.cat("REQ"), subcategoryId: await id.cat("REQ-SW"), priorityId: await id.prio("P1"),
  });
}
/** Shift ticket creation (and clock state) into the past to simulate elapsed time. */
async function age(ticketId: string, minutes: number) {
  const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  await prisma.ticket.update({ where: { id: ticketId }, data: { createdAt: new Date(t.createdAt.getTime() - minutes * MIN) } });
}
const events = (ticketId: string) => prisma.slaEvent.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } });

afterAll(() => prisma.$disconnect());

describe("clock lifecycle", () => {
  it("snapshots targets and starts both clocks on creation", async () => {
    const t = await newP1("SLA snapshot test");
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ responseTargetMin: 15, resolutionTargetMin: 240, slaBusinessHours: false });
    expect(row.resolutionDueAt!.getTime() - row.createdAt.getTime()).toBe(240 * MIN);
    expect((await events(t.id)).map((e) => `${e.clock}:${e.type}`)).toEqual(["RESPONSE:STARTED", "RESOLUTION:STARTED"]);
  });

  it("pauses in a pause status and resumes with the exact paused time added", async () => {
    const t = await newP1("SLA pause test");
    const ana = await actor("agent");
    await assignTicket(await actor("lead"), { ticketId: t.id, agentId: ana.id });
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await id.status("IN_PROGRESS") });
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await id.status("WAITING_USER"), reason: "Need screenshot" });
    let row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.slaPausedAt).not.toBeNull();
    await prisma.ticket.update({ where: { id: t.id }, data: { slaPausedAt: new Date(row.slaPausedAt!.getTime() - 30 * MIN) } }); // paused 30 min ago
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await id.status("IN_PROGRESS") });
    row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.slaPausedAt).toBeNull();
    expect(row.slaPausedMinutes).toBe(30);
    expect(row.resolutionDueAt!.getTime() - row.createdAt.getTime()).toBe((240 + 30) * MIN);
    expect((await events(t.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["PAUSED", "RESUMED"]));
  });

  it("a status outside the profile's pause list does not pause", async () => {
    const t = await newP1("SLA on-hold test");
    const ana = await actor("agent");
    await assignTicket(await actor("lead"), { ticketId: t.id, agentId: ana.id });
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await id.status("ON_HOLD"), reason: "Parts" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).slaPausedAt).toBeNull();
  });

  it("resolution stops the clock; reopening continues it", async () => {
    const t = await newP1("SLA resolve/reopen test");
    const ana = await actor("agent");
    await assignTicket(await actor("lead"), { ticketId: t.id, agentId: ana.id });
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await id.status("IN_PROGRESS") });
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await id.status("RESOLVED"), resolutionSummary: "Done" });
    let row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.slaPausedAt).not.toBeNull();
    expect(row.resolutionBreached).toBe(false);
    expect((await events(t.id)).some((e) => e.clock === "RESOLUTION" && e.type === "MET")).toBe(true);
    await prisma.ticket.update({ where: { id: t.id }, data: { slaPausedAt: new Date(row.slaPausedAt!.getTime() - 60 * MIN) } });
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await id.status("IN_PROGRESS") });
    row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.slaPausedMinutes).toBe(60);
    expect(row.resolutionDueAt!.getTime() - row.createdAt.getTime()).toBe((240 + 60) * MIN);
  });

  it("first public chat reply by staff meets the response clock (late → breached flag)", async () => {
    const t = await newP1("SLA chat response test");
    await age(t.id, 20); // 20 min > 15 min response target
    await postMessage(await actor("agent"), t.id, { body: "Looking into it" });
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.firstResponseAt).not.toBeNull();
    expect(row.responseBreached).toBe(true);
    const ev = (await events(t.id)).find((e) => e.clock === "RESPONSE" && e.type !== "STARTED");
    expect(ev?.type).toBe("BREACHED");
    expect(ev?.detail).toMatch(/late/);
  });

  it("priority change re-snapshots targets and keeps the pause ledger", async () => {
    const t = await newP1("SLA priority change test");
    await prisma.ticket.update({ where: { id: t.id }, data: { slaPausedMinutes: 10 } });
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    await updateTicketFields(await actor("agent"), t.id, {
      subject: before.subject, description: before.description, categoryId: before.categoryId, subcategoryId: before.subcategoryId,
      priorityId: await id.prio("P2"), branchId: before.branchId, locationId: before.locationId, contactNumber: before.contactNumber,
    });
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ responseTargetMin: 30, resolutionTargetMin: 480, slaPausedMinutes: 10 });
    expect(row.resolutionDueAt!.getTime() - row.createdAt.getTime()).toBe((480 + 10) * MIN);
  });
});

describe("SLA sweep job", () => {
  it("records warnings, breaches and notifications exactly once", async () => {
    const t = await newP1("SLA sweep warning test");
    // Unassigned: no first response yet, so the response clock is still open. Owner team (incl. Ana) is notified.
    await age(t.id, 200); // response (15) breached, resolution 200/240 = 83% → warning
    const r1 = await runSlaSweep();
    expect(r1.skipped).toBe(false);
    const ev = await events(t.id);
    expect(ev.filter((e) => e.clock === "RESPONSE" && e.type === "BREACHED")).toHaveLength(1);
    expect(ev.filter((e) => e.clock === "RESOLUTION" && e.type === "WARNING")).toHaveLength(1);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.responseBreached).toBe(true);
    expect(row.resolutionBreached).toBe(false);
    const ana = await actor("agent");
    expect(await prisma.notification.count({ where: { userId: ana.id, ticketId: t.id, type: "SLA_BREACHED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ana.id, ticketId: t.id, type: "SLA_WARNING" } })).toBe(1);
    // seeded rule: resolution 75% → notify team leads
    expect(ev.some((e) => e.type === "ESCALATED")).toBe(true);
    await runSlaSweep();
    expect((await events(t.id)).length).toBe(ev.length);
    expect(await prisma.notification.count({ where: { userId: ana.id, ticketId: t.id, type: { in: ["SLA_BREACHED", "SLA_WARNING"] } } })).toBe(2);
  });

  it("escalation rule transfers to another team once", async () => {
    const profile = await prisma.slaProfile.findFirstOrThrow({ where: { isDefault: true } });
    const infraId = await id.team("INFRA");
    const rule = await prisma.escalationRule.create({ data: { slaProfileId: profile.id, clock: "RESOLUTION", atPercent: 150, notifyTeamLead: false, escalateToTeamId: infraId } });
    const t = await newP1("SLA escalation transfer test");
    await age(t.id, 400); // 400/240 = 167%
    await runSlaSweep();
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, include: { assignments: { orderBy: { createdAt: "desc" } } } });
    expect(row.ownerTeamId).toBe(infraId);
    expect(row.assignments[0]).toMatchObject({ type: "ESCALATE", changedById: null });
    expect(row.resolutionBreached).toBe(true);
    const ivan = await actor("infra");
    expect(await prisma.notification.count({ where: { userId: ivan.id, ticketId: t.id, type: "TICKET_ESCALATED" } })).toBe(1);
    await runSlaSweep();
    expect(await prisma.ticketAssignment.count({ where: { ticketId: t.id, type: "ESCALATE" } })).toBe(1);
    await prisma.escalationRule.delete({ where: { id: rule.id } });
  });

  it("notifies overdue tasks once", async () => {
    const t = await newP1("SLA overdue task test");
    const lee = await actor("lead");
    await assignTicket(lee, { ticketId: t.id, agentId: (await actor("agent")).id });
    const task = await createTask(lee, t.id, { title: "Overdue check", teamId: await id.team("INFRA"), dueDate: new Date(Date.now() - 3600_000).toISOString() });
    await runSlaSweep();
    await runSlaSweep();
    const ivan = await actor("infra");
    expect(await prisma.notification.count({ where: { userId: ivan.id, type: "TASK_OVERDUE", ticketId: t.id } })).toBe(1);
    expect((await prisma.ticketTask.findUniqueOrThrow({ where: { id: task.id } })).overdueNotifiedAt).not.toBeNull();
  });

  it("auto-closes resolved tickets after the configured days (and not when disabled)", async () => {
    const admin = await actor("admin");
    const ana = await actor("agent");
    const mk = async (subject: string) => {
      const t = await newP1(subject);
      await assignTicket(await actor("lead"), { ticketId: t.id, agentId: ana.id });
      await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await id.status("IN_PROGRESS") });
      await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await id.status("RESOLVED"), resolutionSummary: "ok" });
      await prisma.ticket.update({ where: { id: t.id }, data: { resolvedAt: new Date(Date.now() - 4 * 86_400_000) } });
      return t;
    };
    await saveSystemSettings(admin, { "tickets.autoCloseResolvedDays": 0 });
    const keep = await mk("Auto-close disabled test");
    await runSlaSweep();
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: keep.id }, include: { status: true } })).status.code).toBe("RESOLVED");
    await saveSystemSettings(admin, { "tickets.autoCloseResolvedDays": 3 });
    await runSlaSweep();
    const closed = await prisma.ticket.findUniqueOrThrow({ where: { id: keep.id }, include: { status: true } });
    expect(closed.status.code).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
    expect(await prisma.ticketHistory.count({ where: { ticketId: keep.id, actorId: null, reason: { contains: "Auto-closed" } } })).toBe(1);
    expect(await prisma.notification.count({ where: { ticketId: keep.id, type: "TICKET_CLOSED" } })).toBe(1);
  });

  it("only one concurrent sweep runs (lease)", async () => {
    const [a, b] = await Promise.all([runSlaSweep(), runSlaSweep()]);
    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
    expect((await runSlaSweep()).skipped).toBe(false); // lease released
  });
});

describe("SLA administration", () => {
  it("validates and audits SLA targets", async () => {
    const admin = await actor("admin");
    const profile = await prisma.slaProfile.findFirstOrThrow({ where: { isDefault: true } });
    const p3 = await id.prio("P3");
    await expect(saveSlaTargets(admin, profile.id, [{ priorityId: p3, responseMinutes: 600, resolutionMinutes: 60, businessHoursOnly: true }])).rejects.toBeInstanceOf(ValidationError);
    await saveSlaTargets(admin, profile.id, [{ priorityId: p3, responseMinutes: 120, resolutionMinutes: 1080, businessHoursOnly: true }]);
    expect(await prisma.slaTarget.findFirstOrThrow({ where: { slaProfileId: profile.id, priorityId: p3 } })).toMatchObject({ responseMinutes: 120, resolutionMinutes: 1080 });
    expect(await prisma.auditLog.count({ where: { action: "SLA_TARGETS_UPDATED", entityId: profile.id } })).toBe(1);
    await expect(saveSlaTargets(await actor("agent"), profile.id, [])).rejects.toThrow();
  });
  it("validates business hours (overlap, end before start, timezone)", async () => {
    const admin = await actor("admin");
    const bad = (schedule: object, timezone = "Asia/Bangkok") => saveBusinessHours(admin, null, { name: `Cal ${Math.random()}`, timezone, isDefault: false, schedule });
    await expect(bad({ "1": [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "14:00" }] })).rejects.toThrow(/overlap/);
    await expect(bad({ "1": [{ start: "17:00", end: "09:00" }] })).rejects.toThrow(/after start/);
    await expect(bad({ "1": [{ start: "09:00", end: "17:00" }] }, "Mars/Olympus")).rejects.toThrow(/timezone/);
    await expect(bad({})).rejects.toThrow(/At least one/);
    await saveBusinessHours(admin, null, { name: "Retail stores (7 days)", timezone: "Asia/Bangkok", isDefault: false,
      schedule: { "1": [{ start: "10:00", end: "22:00" }], "6": [{ start: "10:00", end: "22:00" }], "7": [{ start: "10:00", end: "22:00" }] } });
    expect(await prisma.auditLog.count({ where: { action: "BUSINESS_HOURS_CREATED" } })).toBe(1);
  });
});
