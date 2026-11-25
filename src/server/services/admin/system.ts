import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { requirePermission } from "@/server/authz/guards";
import { ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { audit } from "../audit";
import { getSettings, SETTINGS_SCHEMA, type SettingKey } from "../settings";
import { validateNumberFormat, formatNumber } from "../numbering";

export async function getSystemSettings(actor: Actor) {
  requirePermission(actor, P.ADMIN_SETTINGS);
  const [settings, sequences, teams, priorities, statuses] = await Promise.all([
    getSettings(prisma),
    prisma.numberSequence.findMany({ orderBy: { key: "asc" } }),
    prisma.supportTeam.findMany({ where: { isActive: true, deletedAt: null }, select: { code: true, name: true, nameTh: true }, orderBy: { name: "asc" } }),
    prisma.priority.findMany({ where: { isActive: true }, orderBy: { level: "asc" } }),
    prisma.ticketStatus.findMany({ where: { isActive: true }, orderBy: { order: "asc" } }),
  ]);
  return { settings, sequences, teams, priorities, statuses };
}

export async function saveSystemSettings(actor: Actor, raw: Record<string, unknown>) {
  requirePermission(actor, P.ADMIN_SETTINGS);
  const current = await getSettings(prisma);
  const updates: { key: SettingKey; value: unknown }[] = [];
  const errors: Record<string, string> = {};
  for (const key of Object.keys(SETTINGS_SCHEMA) as SettingKey[]) {
    if (!(key in raw)) continue;
    const parsed = SETTINGS_SCHEMA[key].safeParse(raw[key]);
    if (!parsed.success) errors[key] = parsed.error.issues[0]?.message ?? "Invalid";
    else if (JSON.stringify(parsed.data) !== JSON.stringify(current[key])) updates.push({ key, value: parsed.data });
  }
  if (Object.keys(errors).length) throw new ValidationError("Please correct the highlighted settings.", errors);
  if (updates.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.systemSetting.upsert({ where: { key: u.key }, update: { value: u.value as Prisma.InputJsonValue }, create: { key: u.key, value: u.value as Prisma.InputJsonValue } });
    }
    await audit(tx, actor, {
      action: "SETTINGS_UPDATED", entityType: "SystemSetting",
      oldValue: Object.fromEntries(updates.map((u) => [u.key, current[u.key]])),
      newValue: Object.fromEntries(updates.map((u) => [u.key, u.value])),
    });
  });
}

export const sequenceSchema = z.object({
  key: z.string().min(1),
  prefix: z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/, "1–10 letters/digits"),
  format: z.string().trim().min(1).max(60),
  resetYearly: z.boolean(),
});

export async function saveSequence(actor: Actor, raw: unknown) {
  requirePermission(actor, P.ADMIN_SETTINGS);
  const s = sequenceSchema.parse(raw);
  const err = validateNumberFormat(s.format);
  if (err) throw new ValidationError(err, { format: err });
  const before = await prisma.numberSequence.findUnique({ where: { key: s.key } });
  if (!before) throw new ValidationError("Unknown sequence.");
  await prisma.$transaction(async (tx) => {
    await tx.numberSequence.update({ where: { key: s.key }, data: { prefix: s.prefix, format: s.format, resetYearly: s.resetYearly } });
    await audit(tx, actor, { action: "NUMBER_FORMAT_CHANGED", entityType: "NumberSequence", entityId: s.key,
      oldValue: { prefix: before.prefix, format: before.format, resetYearly: before.resetYearly }, newValue: s });
  });
  return formatNumber(s.format, s.prefix, new Date(), before.current + 1);
}

// ───────────────────────────── Audit log ─────────────────────────────

export interface AuditQuery { q?: string; action?: string; entity?: string; actor?: string; from?: string; to?: string; page?: number }

const isoDay = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);

/** Filter shared by the audit list and exports. Invalid dates are ignored. */
export function auditWhere(raw: AuditQuery): Prisma.AuditLogWhereInput {
  const q = { ...raw, from: isoDay(raw.from), to: isoDay(raw.to) };
  return {
    ...(q.action ? { action: q.action } : {}),
    ...(q.entity ? { entityType: q.entity } : {}),
    ...(q.actor ? { actorId: q.actor } : {}),
    ...(q.q ? { OR: [{ entityId: q.q }, { ticket: { number: { contains: q.q, mode: "insensitive" } } }, { actor: { displayName: { contains: q.q, mode: "insensitive" } } }] } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}) } } : {}),
  };
}

export async function listAuditLogs(actor: Actor, q: AuditQuery) {
  requirePermission(actor, P.AUDIT_READ);
  const page = Math.max(1, q.page ?? 1);
  const take = 50;
  const where = auditWhere(q);
  const [total, rows, actions, entities] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, include: { actor: { select: { displayName: true, email: true } }, ticket: { select: { number: true } } },
      orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
  ]);
  return { total, rows, page, pages: Math.max(1, Math.ceil(total / take)), actions: actions.map((a) => a.action), entities: entities.map((e) => e.entityType) };
}


// ───────────────────────────── SLA targets ─────────────────────────────

export async function getSlaProfileDetail(actor: Actor, id: string) {
  requirePermission(actor, P.ADMIN_SLA);
  const profile = await prisma.slaProfile.findUnique({
    where: { id },
    include: {
      businessHours: { include: { holidays: true } }, targets: true,
      escalations: { include: { escalateToTeam: true }, orderBy: [{ clock: "asc" }, { atPercent: "asc" }] },
      categories: { select: { name: true, nameTh: true, parent: { select: { name: true, nameTh: true } } } }, teams: { select: { name: true, nameTh: true } },
    },
  });
  if (!profile) return null;
  const [priorities, defaultBh] = await Promise.all([
    prisma.priority.findMany({ where: { isActive: true }, orderBy: { level: "asc" } }),
    prisma.businessHours.findFirst({ where: { isDefault: true }, include: { holidays: true } }),
  ]);
  return { profile, priorities, calendar: profile.businessHours ?? defaultBh };
}

const targetRow = z.object({
  priorityId: z.string().min(1),
  responseMinutes: z.number().int().min(1, "Response time must be at least 1 minute").max(525_600),
  resolutionMinutes: z.number().int().min(1, "Resolution time must be at least 1 minute").max(1_051_200),
  businessHoursOnly: z.boolean(),
});

export async function saveSlaTargets(actor: Actor, profileId: string, raw: unknown) {
  requirePermission(actor, P.ADMIN_SLA);
  const parsed = z.array(targetRow).min(1).safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid targets");
  const rows = parsed.data;
  const errs: Record<string, string> = {};
  for (const r of rows) if (r.resolutionMinutes < r.responseMinutes) errs[r.priorityId] = "Resolution time must not be shorter than response time";
  if (Object.keys(errs).length) throw new ValidationError("Resolution time must not be shorter than response time.", errs);
  const profile = await prisma.slaProfile.findUnique({ where: { id: profileId }, include: { targets: true } });
  if (!profile) throw new ValidationError("Unknown SLA profile.");
  const before = profile.targets.map((t) => ({ priorityId: t.priorityId, responseMinutes: t.responseMinutes, resolutionMinutes: t.resolutionMinutes, businessHoursOnly: t.businessHoursOnly }));
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.slaTarget.upsert({
        where: { slaProfileId_priorityId: { slaProfileId: profileId, priorityId: r.priorityId } },
        update: { responseMinutes: r.responseMinutes, resolutionMinutes: r.resolutionMinutes, businessHoursOnly: r.businessHoursOnly },
        create: { slaProfileId: profileId, ...r },
      });
    }
    await audit(tx, actor, { action: "SLA_TARGETS_UPDATED", entityType: "SlaProfile", entityId: profileId, oldValue: before, newValue: rows });
  });
}

// ───────────────────────────── Business hours ─────────────────────────────

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const windowSchema = z.object({ start: z.string().regex(HM, "Use HH:MM"), end: z.string().regex(HM, "Use HH:MM") });
export const businessHoursSchema = z.object({
  name: z.string().trim().min(1).max(100),
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown timezone"),
  isDefault: z.boolean(),
  schedule: z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), z.array(windowSchema).max(3)),
});

/** Validates windows: end after start, no overlaps, at least one working window in the week. */
export function validateSchedule(schedule: Record<string, { start: string; end: string }[]>): string | null {
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  let any = false;
  for (const [day, windows] of Object.entries(schedule)) {
    const sorted = [...windows].sort((a, b) => mins(a.start) - mins(b.start));
    for (let i = 0; i < sorted.length; i++) {
      const w = sorted[i]!;
      if (mins(w.end) <= mins(w.start)) return `Day ${day}: end time must be after start time (${w.start}–${w.end}).`;
      if (i > 0 && mins(w.start) < mins(sorted[i - 1]!.end)) return `Day ${day}: working windows overlap.`;
      any = true;
    }
  }
  return any ? null : "At least one working window is required.";
}

export async function listBusinessHours(actor: Actor) {
  requirePermission(actor, P.ADMIN_SLA);
  return prisma.businessHours.findMany({ include: { holidays: { orderBy: { date: "asc" } }, _count: { select: { profiles: true } } }, orderBy: { name: "asc" } });
}

export async function saveBusinessHours(actor: Actor, id: string | null, raw: unknown) {
  requirePermission(actor, P.ADMIN_SLA);
  const parsed = businessHoursSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid business hours");
  const input = parsed.data;
  const schedule = Object.fromEntries(Object.entries(input.schedule).filter(([, w]) => w.length > 0));
  const err = validateSchedule(schedule);
  if (err) throw new ValidationError(err);
  await prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.businessHours.updateMany({ where: { isDefault: true, ...(id ? { NOT: { id } } : {}) }, data: { isDefault: false } });
    if (id) {
      const before = await tx.businessHours.findUniqueOrThrow({ where: { id } });
      if (before.isDefault && !input.isDefault) throw new ValidationError("Choose another default calendar instead of un-setting this one.");
      await tx.businessHours.update({ where: { id }, data: { name: input.name, timezone: input.timezone, isDefault: input.isDefault, schedule } });
      await audit(tx, actor, { action: "BUSINESS_HOURS_UPDATED", entityType: "BusinessHours", entityId: id,
        oldValue: { name: before.name, timezone: before.timezone, schedule: before.schedule }, newValue: { name: input.name, timezone: input.timezone, schedule } });
    } else {
      const created = await tx.businessHours.create({ data: { name: input.name, timezone: input.timezone, isDefault: input.isDefault, schedule } });
      await audit(tx, actor, { action: "BUSINESS_HOURS_CREATED", entityType: "BusinessHours", entityId: created.id, newValue: { name: input.name, timezone: input.timezone, schedule } });
    }
  }).catch((e: unknown) => {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw new ValidationError("A calendar with this name already exists.");
    throw e;
  });
}

/** Manual trigger of the SLA job (ops / demos). */
export async function runSlaCheckNow(actor: Actor) {
  requirePermission(actor, P.ADMIN_SLA);
  const { runSlaSweep } = await import("@/server/jobs/sla-sweep");
  const result = await runSlaSweep();
  await prisma.$transaction(async (tx) => audit(tx, actor, { action: "SLA_SWEEP_RUN", entityType: "System", newValue: result }));
  return result;
}
