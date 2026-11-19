import type { ApprovalStatus, Prisma, PrismaClient, StatusKind } from "@prisma/client";
import type { BusinessCalendar, WeeklySchedule } from "@/server/domain/sla-calendar";
import {
  addClockMinutes, businessMinutesBetween, evaluateClock, isPausedStatus, type ClockResult,
} from "@/server/domain/sla-engine";

type Db = Prisma.TransactionClient | PrismaClient;

const profileInclude = { businessHours: { include: { holidays: true } } } as const;
type ProfileWithCal = Prisma.SlaProfileGetPayload<{ include: typeof profileInclude }>;

function toCalendar(bh: ProfileWithCal["businessHours"]): BusinessCalendar | null {
  if (!bh) return null;
  return { timezone: bh.timezone, schedule: bh.schedule as WeeklySchedule, holidays: bh.holidays.map((h) => h.date.toISOString().slice(0, 10)) };
}

async function defaultCalendar(db: Db) {
  return db.businessHours.findFirst({ where: { isDefault: true }, include: { holidays: true } });
}

/**
 * Resolves the SLA profile and returns the target snapshot plus due dates.
 * Profile precedence: subcategory → category → owner team → default profile.
 * `pausedBusinessMinutes` shifts due dates by time already spent paused (recalculation).
 */
export async function computeSlaTargets(
  db: Db,
  args: {
    subcategorySlaProfileId?: string | null; categorySlaProfileId?: string | null; teamId?: string | null;
    priorityId: string; start: Date; pausedBusinessMinutes?: number;
  },
) {
  let profileId = args.subcategorySlaProfileId ?? args.categorySlaProfileId ?? null;
  if (!profileId && args.teamId) {
    const team = await db.supportTeam.findUnique({ where: { id: args.teamId }, select: { slaProfileId: true } });
    profileId = team?.slaProfileId ?? null;
  }
  const profile = profileId
    ? await db.slaProfile.findFirst({ where: { id: profileId, isActive: true }, include: profileInclude })
    : await db.slaProfile.findFirst({ where: { isDefault: true, isActive: true }, include: profileInclude });
  const none = { slaProfileId: profile?.id ?? null, responseDueAt: null, resolutionDueAt: null, responseTargetMin: null, resolutionTargetMin: null, slaBusinessHours: true };
  if (!profile) return none;
  const target = await db.slaTarget.findUnique({ where: { slaProfileId_priorityId: { slaProfileId: profile.id, priorityId: args.priorityId } } });
  if (!target) return none;

  const cal = target.businessHoursOnly ? toCalendar(profile.businessHours ?? (await defaultCalendar(db))) : null;
  const paused = args.pausedBusinessMinutes ?? 0;
  return {
    slaProfileId: profile.id,
    responseTargetMin: target.responseMinutes,
    resolutionTargetMin: target.resolutionMinutes,
    slaBusinessHours: !!cal,
    responseDueAt: addClockMinutes(args.start, target.responseMinutes + paused, cal),
    resolutionDueAt: addClockMinutes(args.start, target.resolutionMinutes + paused, cal),
  };
}

// ───────────────────────────── Ticket SLA context ─────────────────────────────

export interface TicketSlaFields {
  id: string;
  createdAt: Date;
  slaProfileId: string | null;
  slaBusinessHours: boolean;
  slaPausedAt: Date | null;
  slaPausedMinutes: number;
  responseTargetMin: number | null;
  resolutionTargetMin: number | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  /** While approval is pending the SLA stays paused regardless of status. */
  approvalStatus?: ApprovalStatus;
}

export const ticketSlaSelect = {
  id: true, createdAt: true, slaProfileId: true, slaBusinessHours: true, slaPausedAt: true, slaPausedMinutes: true,
  responseTargetMin: true, resolutionTargetMin: true, firstResponseAt: true, resolvedAt: true, responseBreached: true, resolutionBreached: true,
  approvalStatus: true,
} satisfies Prisma.TicketSelect;

export interface SlaContext {
  profile: ProfileWithCal | null;
  calendar: BusinessCalendar | null;
  warningPercent: number;
  pauseCodes: unknown;
}

/** Profile + calendar for a ticket (calendar null = 24x7). */
export async function slaContext(db: Db, t: Pick<TicketSlaFields, "slaProfileId" | "slaBusinessHours">): Promise<SlaContext> {
  const profile = t.slaProfileId ? await db.slaProfile.findUnique({ where: { id: t.slaProfileId }, include: profileInclude }) : null;
  const calendar = t.slaBusinessHours ? toCalendar(profile?.businessHours ?? (await defaultCalendar(db))) : null;
  return { profile, calendar, warningPercent: profile?.warningPercent ?? 75, pauseCodes: profile?.pauseStatusCodes ?? [] };
}

export function evaluateTicketClocks(t: TicketSlaFields, ctx: SlaContext, now = new Date()): { response: ClockResult; resolution: ClockResult } {
  const base = { createdAt: t.createdAt, pausedBusinessMinutes: t.slaPausedMinutes, pausedAt: t.slaPausedAt, warningPercent: ctx.warningPercent, calendar: ctx.calendar };
  return {
    response: evaluateClock({ ...base, targetMinutes: t.responseTargetMin, metAt: t.firstResponseAt, pausedAt: t.firstResponseAt ? null : t.slaPausedAt }, now),
    resolution: evaluateClock({ ...base, targetMinutes: t.resolutionTargetMin, metAt: t.resolvedAt }, now),
  };
}

function dueDates(t: TicketSlaFields, ctx: SlaContext, pausedMinutes: number) {
  return {
    responseDueAt: t.responseTargetMin != null ? addClockMinutes(t.createdAt, t.responseTargetMin + pausedMinutes, ctx.calendar) : null,
    resolutionDueAt: t.resolutionTargetMin != null ? addClockMinutes(t.createdAt, t.resolutionTargetMin + pausedMinutes, ctx.calendar) : null,
  };
}

const lateDetail = (r: ClockResult) =>
  r.remainingMinutes != null && r.remainingMinutes < 0 ? `late by ${Math.abs(r.remainingMinutes)} min` : `${r.remainingMinutes ?? 0} min to spare`;

// ───────────────────────────── Status-change hook ─────────────────────────────

/**
 * Applies SLA effects of a status change: pause/resume (profile pause conditions),
 * resolution met/breached at RESOLVED (clock stops; a reopen resumes it).
 * Returns the ticket update data; writes SlaEvents. Call inside the same transaction.
 */
export async function applyStatusChange(
  tx: Prisma.TransactionClient,
  t: TicketSlaFields,
  to: { code: string; kind: StatusKind; pausesSla: boolean },
  now = new Date(),
): Promise<Prisma.TicketUncheckedUpdateInput> {
  const ctx = await slaContext(tx, t);
  const stopKinds: StatusKind[] = ["RESOLVED", "CLOSED", "CANCELLED"];
  const shouldPause = stopKinds.includes(to.kind) || isPausedStatus(to.code, to.pausesSla, ctx.pauseCodes) || t.approvalStatus === "PENDING";
  const wasPaused = !!t.slaPausedAt;
  const data: Prisma.TicketUncheckedUpdateInput = {};
  const events: Prisma.SlaEventCreateManyInput[] = [];
  const openClocks = (["RESPONSE", "RESOLUTION"] as const).filter((c) =>
    c === "RESPONSE" ? t.responseTargetMin != null && !t.firstResponseAt : t.resolutionTargetMin != null && (!t.resolvedAt || !stopKinds.includes(to.kind)));

  if (!wasPaused && shouldPause) {
    data.slaPausedAt = now;
    if (!stopKinds.includes(to.kind)) for (const c of openClocks) events.push({ ticketId: t.id, clock: c, type: "PAUSED", detail: to.code });
  } else if (wasPaused && !shouldPause) {
    const add = businessMinutesBetween(t.slaPausedAt!, now, ctx.calendar);
    const paused = t.slaPausedMinutes + add;
    data.slaPausedAt = null;
    data.slaPausedMinutes = paused;
    Object.assign(data, dueDates(t, ctx, paused));
    for (const c of openClocks) events.push({ ticketId: t.id, clock: c, type: "RESUMED", detail: `paused ${add} min` });
  }

  if (to.kind === "RESOLVED" && t.resolutionTargetMin != null) {
    const r = evaluateTicketClocks({ ...t, resolvedAt: now }, ctx, now).resolution;
    events.push({ ticketId: t.id, clock: "RESOLUTION", type: r.state === "MET" ? "MET" : "BREACHED", detail: lateDetail(r) });
    if (r.state !== "MET") data.resolutionBreached = true;
  }
  if (events.length) await tx.slaEvent.createMany({ data: events });
  return data;
}

/** Pauses running clocks while a ticket waits for approval (no-op when already paused). */
export async function pauseForApproval(tx: Prisma.TransactionClient, t: TicketSlaFields, now = new Date()): Promise<Prisma.TicketUncheckedUpdateInput> {
  if (t.slaPausedAt) return {};
  const clocks = (["RESPONSE", "RESOLUTION"] as const).filter((c) => (c === "RESPONSE" ? t.responseTargetMin != null && !t.firstResponseAt : t.resolutionTargetMin != null));
  if (clocks.length) await tx.slaEvent.createMany({ data: clocks.map((clock) => ({ ticketId: t.id, clock, type: "PAUSED" as const, detail: "approval" })) });
  return { slaPausedAt: now };
}

/**
 * Resumes clocks after approval — unless the ticket's current status pauses (or stops)
 * the SLA on its own, in which case the pause simply continues.
 */
export async function resumeAfterApproval(
  tx: Prisma.TransactionClient, t: TicketSlaFields, status: { code: string; kind: StatusKind; pausesSla: boolean }, now = new Date(),
): Promise<Prisma.TicketUncheckedUpdateInput> {
  if (!t.slaPausedAt) return {};
  const ctx = await slaContext(tx, t);
  if (["RESOLVED", "CLOSED", "CANCELLED"].includes(status.kind) || isPausedStatus(status.code, status.pausesSla, ctx.pauseCodes)) return {};
  const add = businessMinutesBetween(t.slaPausedAt, now, ctx.calendar);
  const paused = t.slaPausedMinutes + add;
  const clocks = (["RESPONSE", "RESOLUTION"] as const).filter((c) => (c === "RESPONSE" ? t.responseTargetMin != null && !t.firstResponseAt : t.resolutionTargetMin != null && !t.resolvedAt));
  if (clocks.length) await tx.slaEvent.createMany({ data: clocks.map((clock) => ({ ticketId: t.id, clock, type: "RESUMED" as const, detail: `approval, paused ${add} min` })) });
  return { slaPausedAt: null, slaPausedMinutes: paused, ...dueDates(t, ctx, paused) };
}

/** Response clock met (first public staff reply / first staff status change). */
export async function recordFirstResponse(tx: Prisma.TransactionClient, t: TicketSlaFields, now = new Date()): Promise<Prisma.TicketUncheckedUpdateInput> {
  if (t.firstResponseAt) return {};
  const data: Prisma.TicketUncheckedUpdateInput = { firstResponseAt: now };
  if (t.responseTargetMin != null) {
    const ctx = await slaContext(tx, t);
    const r = evaluateTicketClocks({ ...t, firstResponseAt: now }, ctx, now).response;
    await tx.slaEvent.create({ data: { ticketId: t.id, clock: "RESPONSE", type: r.state === "MET" ? "MET" : "BREACHED", detail: lateDetail(r) } });
    if (r.state !== "MET") data.responseBreached = true;
  }
  return data;
}

/** Re-snapshot targets (priority/category/team change) keeping the pause ledger. */
export async function recalculateTargets(
  db: Db,
  t: TicketSlaFields,
  args: { subcategorySlaProfileId?: string | null; categorySlaProfileId?: string | null; teamId?: string | null; priorityId: string },
) {
  const r = await computeSlaTargets(db, { ...args, start: t.createdAt, pausedBusinessMinutes: t.slaPausedMinutes });
  return r;
}

export async function startClocks(tx: Prisma.TransactionClient, ticketId: string, hasTargets: boolean) {
  if (!hasTargets) return;
  await tx.slaEvent.createMany({ data: [{ ticketId, clock: "RESPONSE", type: "STARTED" }, { ticketId, clock: "RESOLUTION", type: "STARTED" }] });
}

// ───────────────────────────── Read model ─────────────────────────────

export async function getTicketSla(db: Db, ticketId: string, now = new Date()) {
  const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { ...ticketSlaSelect, slaEvents: { orderBy: { createdAt: "asc" } } } });
  const ctx = await slaContext(db, t);
  const clocks = evaluateTicketClocks(t, ctx, now);
  return {
    profileName: ctx.profile?.name ?? null,
    calendarName: t.slaBusinessHours ? (ctx.profile?.businessHours?.name ?? "Default calendar") : null,
    businessHours: t.slaBusinessHours,
    warningPercent: ctx.warningPercent,
    paused: !!t.slaPausedAt,
    response: { ...clocks.response, targetMinutes: t.responseTargetMin, breachedFlag: t.responseBreached },
    resolution: { ...clocks.resolution, targetMinutes: t.resolutionTargetMin, breachedFlag: t.resolutionBreached },
    events: t.slaEvents.map((e) => ({ id: e.id, clock: e.clock, type: e.type, detail: e.detail, createdAt: e.createdAt })),
  };
}
export type TicketSla = Awaited<ReturnType<typeof getTicketSla>>;
