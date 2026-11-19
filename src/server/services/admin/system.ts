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
    prisma.supportTeam.findMany({ where: { isActive: true, deletedAt: null }, select: { code: true, name: true }, orderBy: { name: "asc" } }),
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

export async function listAuditLogs(actor: Actor, q: { q?: string; action?: string; entity?: string; actor?: string; from?: string; to?: string; page?: number }) {
  requirePermission(actor, P.AUDIT_READ);
  const page = Math.max(1, q.page ?? 1);
  const take = 50;
  const where: Prisma.AuditLogWhereInput = {
    ...(q.action ? { action: q.action } : {}),
    ...(q.entity ? { entityType: q.entity } : {}),
    ...(q.actor ? { actorId: q.actor } : {}),
    ...(q.q ? { OR: [{ entityId: q.q }, { ticket: { number: { contains: q.q, mode: "insensitive" } } }, { actor: { displayName: { contains: q.q, mode: "insensitive" } } }] } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}) } } : {}),
  };
  const [total, rows, actions, entities] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, include: { actor: { select: { displayName: true, email: true } }, ticket: { select: { number: true } } },
      orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
  ]);
  return { total, rows, page, pages: Math.max(1, Math.ceil(total / take)), actions: actions.map((a) => a.action), entities: entities.map((e) => e.entityType) };
}

// ───────────────────────────── SLA (read-only in Phase 1) ─────────────────────────────

export async function getSlaOverview(actor: Actor) {
  requirePermission(actor, P.ADMIN_SLA);
  return prisma.slaProfile.findMany({
    include: { businessHours: { include: { holidays: true } }, targets: { include: { priority: true }, orderBy: { priority: { level: "asc" } } }, escalations: true },
    orderBy: { name: "asc" },
  });
}
