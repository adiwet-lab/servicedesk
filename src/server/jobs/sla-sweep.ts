import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultDb } from "@/server/db";
import { transaction } from "@/server/db-tx";
import { dueEscalations, formatClockMinutes } from "@/server/domain/sla-engine";
import { audit } from "@/server/services/audit";
import { notifyUsers, teamMemberIds } from "@/server/services/notifications";
import { getSettings } from "@/server/services/settings";
import { computeSlaTargets, evaluateTicketClocks, slaContext, ticketSlaSelect, type SlaContext } from "@/server/services/sla";

export interface SweepResult {
  skipped: boolean;
  backfilled: number;
  warnings: number;
  breaches: number;
  escalations: number;
  tasksOverdue: number;
  autoClosed: number;
  errors: number;
  durationMs: number;
}

const LEASE_KEY = "jobs.slaSweep.lease";

/**
 * Lease so only one app instance sweeps at a time (multi-replica safe).
 * Atomic: inserts or takes over an expired lease in a single statement.
 */
async function acquireLease(db: PrismaClient, holder: string, ttlMs: number): Promise<boolean> {
  const until = new Date(Date.now() + ttlMs).toISOString();
  const value = JSON.stringify({ holder, until });
  const rows = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "SystemSetting" ("key", "value", "updatedAt") VALUES (${LEASE_KEY}, ${value}::jsonb, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
      WHERE ("SystemSetting"."value"->>'until')::timestamptz < NOW()
    RETURNING "key"`;
  return rows.length === 1;
}

async function releaseLease(db: PrismaClient, holder: string) {
  await db.$executeRaw`
    UPDATE "SystemSetting" SET "value" = jsonb_set("value", '{until}', to_jsonb(NOW()::text)), "updatedAt" = NOW()
     WHERE "key" = ${LEASE_KEY} AND "value"->>'holder' = ${holder}`;
}

async function recipientsFor(tx: Prisma.TransactionClient, t: { assignedAgentId: string | null; ownerTeamId: string | null }) {
  const base = t.assignedAgentId ? [t.assignedAgentId] : await teamMemberIds(tx, t.ownerTeamId);
  return [...base, ...(await teamMemberIds(tx, t.ownerTeamId, true))];
}

/**
 * Idempotent SLA & housekeeping sweep. Every effect is recorded (SlaEvent /
 * flags / overdueNotifiedAt), so re-running never duplicates notifications.
 */
export async function runSlaSweep(opts: { now?: Date; db?: PrismaClient; batch?: number } = {}): Promise<SweepResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const started = Date.now();
  const r: SweepResult = { skipped: false, backfilled: 0, warnings: 0, breaches: 0, escalations: 0, tasksOverdue: 0, autoClosed: 0, errors: 0, durationMs: 0 };
  const holder = randomUUID();
  if (!(await acquireLease(db, holder, 5 * 60_000))) return { ...r, skipped: true, durationMs: Date.now() - started };

  const safely = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      r.errors++;
      console.error("[jobs] sla sweep item failed", e);
    }
  };

  try {
    const batch = opts.batch ?? 1000;
    const activeKinds = { status: { kind: { in: ["NEW", "OPEN", "WAITING"] as ("NEW" | "OPEN" | "WAITING")[] } } };

    // 1. Backfill target snapshots for tickets created before SLA tracking.
    const missing = await db.ticket.findMany({
      where: { deletedAt: null, responseTargetMin: null, resolutionTargetMin: null, ...activeKinds },
      select: { id: true, categoryId: true, subcategoryId: true, ownerTeamId: true, priorityId: true, createdAt: true, slaPausedMinutes: true,
        category: { select: { slaProfileId: true } }, subcategory: { select: { slaProfileId: true } } },
      take: batch,
    });
    for (const t of missing) {
      await safely(async () => {
        const sla = await computeSlaTargets(db, {
          subcategorySlaProfileId: t.subcategory?.slaProfileId, categorySlaProfileId: t.category.slaProfileId, teamId: t.ownerTeamId,
          priorityId: t.priorityId, start: t.createdAt, pausedBusinessMinutes: t.slaPausedMinutes,
        });
        if (sla.responseTargetMin == null) return;
        await db.ticket.update({ where: { id: t.id }, data: sla });
        r.backfilled++;
      });
    }

    // 2. Warning / breach / escalation on open clocks.
    const tickets = await db.ticket.findMany({
      where: { deletedAt: null, ...activeKinds, OR: [{ responseTargetMin: { not: null } }, { resolutionTargetMin: { not: null } }] },
      select: { ...ticketSlaSelect, number: true, subject: true, ownerTeamId: true, assignedAgentId: true },
      take: batch, orderBy: { createdAt: "asc" },
    });
    const events = await db.slaEvent.findMany({
      where: { ticketId: { in: tickets.map((t) => t.id) }, type: { in: ["WARNING", "BREACHED", "ESCALATED", "MET"] } },
      select: { ticketId: true, clock: true, type: true, detail: true },
    });
    const ctxCache = new Map<string, SlaContext>();
    const rulesCache = new Map<string, Awaited<ReturnType<typeof db.escalationRule.findMany>>>();

    for (const t of tickets) {
      await safely(async () => {
        const key = `${t.slaProfileId}:${t.slaBusinessHours}`;
        let ctx = ctxCache.get(key);
        if (!ctx) ctxCache.set(key, (ctx = await slaContext(db, t)));
        const clocks = evaluateTicketClocks(t, ctx, now);
        const has = (clock: string, type: string) => events.some((e) => e.ticketId === t.id && e.clock === clock && e.type === type);
        const link = `/admin/tickets/${t.number}`;

        for (const clock of ["RESPONSE", "RESOLUTION"] as const) {
          const c = clock === "RESPONSE" ? clocks.response : clocks.resolution;
          const label = clock === "RESPONSE" ? "response" : "resolution";
          if (c.state === "BREACHED" && !has(clock, "BREACHED")) {
            await transaction(async (tx) => {
              await tx.slaEvent.create({ data: { ticketId: t.id, clock, type: "BREACHED", detail: `overdue by ${formatClockMinutes(-(c.remainingMinutes ?? 0))}` } });
              await tx.ticket.update({ where: { id: t.id }, data: clock === "RESPONSE" ? { responseBreached: true } : { resolutionBreached: true } });
              await audit(tx, null, { action: "SLA_BREACHED", entityType: "Ticket", entityId: t.id, ticketId: t.id, newValue: { clock, dueAt: c.dueAt } });
              await notifyUsers(tx, await recipientsFor(tx, t), {
                type: "SLA_BREACHED", title: `SLA breached (${label}): ${t.number}`, body: t.subject, ticketId: t.id, link,
              });
            });
            r.breaches++;
          } else if (c.state === "WARNING" && !has(clock, "WARNING") && !has(clock, "BREACHED")) {
            await transaction(async (tx) => {
              await tx.slaEvent.create({ data: { ticketId: t.id, clock, type: "WARNING", detail: `${c.elapsedPercent}% elapsed, ${formatClockMinutes(c.remainingMinutes ?? 0)} left` } });
              await audit(tx, null, { action: "SLA_WARNING", entityType: "Ticket", entityId: t.id, ticketId: t.id, newValue: { clock, elapsedPercent: c.elapsedPercent } });
              await notifyUsers(tx, await recipientsFor(tx, t), {
                type: "SLA_WARNING", title: `SLA warning (${label}): ${t.number} — ${formatClockMinutes(c.remainingMinutes ?? 0)} left`, body: t.subject, ticketId: t.id, link,
              });
            });
            r.warnings++;
          }
        }

        // Escalation rules of the ticket's profile
        if (!t.slaProfileId) return;
        let rules = rulesCache.get(t.slaProfileId);
        if (!rules) rulesCache.set(t.slaProfileId, (rules = await db.escalationRule.findMany({ where: { slaProfileId: t.slaProfileId, isActive: true } })));
        const fired = new Set(events.filter((e) => e.ticketId === t.id && e.type === "ESCALATED" && e.detail?.startsWith("rule:")).map((e) => e.detail!.slice(5)));
        const open = (c: typeof clocks.response) => (c.state === "MET" || c.state === "MET_LATE" || c.state === "NONE" ? null : c.elapsedPercent);
        const due = dueEscalations(rules, { RESPONSE: open(clocks.response), RESOLUTION: open(clocks.resolution) }, fired);
        for (const rule of due) {
          await transaction(async (tx) => {
            const current = await tx.ticket.findUniqueOrThrow({ where: { id: t.id }, select: { ownerTeamId: true, assignedAgentId: true } });
            await tx.slaEvent.create({ data: { ticketId: t.id, clock: rule.clock, type: "ESCALATED", detail: `rule:${rule.id}` } });
            const reason = `SLA escalation: ${rule.clock.toLowerCase()} at ${rule.atPercent}%`;
            if (rule.notifyTeamLead) {
              await notifyUsers(tx, await teamMemberIds(tx, current.ownerTeamId, true), {
                type: "TICKET_ESCALATED", title: `${reason} — ${t.number}`, body: t.subject, ticketId: t.id, link,
              });
            }
            if (rule.escalateToTeamId && rule.escalateToTeamId !== current.ownerTeamId) {
              const team = await tx.supportTeam.findFirst({ where: { id: rule.escalateToTeamId, isActive: true, deletedAt: null } });
              if (team) {
                await tx.ticket.update({ where: { id: t.id }, data: { ownerTeamId: team.id, assignedAgentId: null } });
                await tx.ticketAssignment.create({ data: { ticketId: t.id, type: "ESCALATE", prevTeamId: current.ownerTeamId, newTeamId: team.id,
                  prevAgentId: current.assignedAgentId, newAgentId: null, changedById: null, reason } });
                await tx.ticketHistory.create({ data: { ticketId: t.id, actorId: null, action: "ESCALATED", field: "escalation", newValue: `→ ${team.name}`, reason } });
                await notifyUsers(tx, await teamMemberIds(tx, team.id, true), {
                  type: "TICKET_ESCALATED", title: `Escalated to ${team.name}: ${t.number}`, body: reason, ticketId: t.id, link,
                });
              }
            }
            await audit(tx, null, { action: "TICKET_ESCALATED", entityType: "Ticket", entityId: t.id, ticketId: t.id,
              newValue: { rule: rule.id, clock: rule.clock, atPercent: rule.atPercent, escalateToTeamId: rule.escalateToTeamId, automatic: true } });
          });
          r.escalations++;
        }
      });
    }

    // 3. Overdue task notifications (once per task).
    const overdueTasks = await db.ticketTask.findMany({
      where: { dueDate: { lt: now }, status: { notIn: ["COMPLETED", "CANCELLED"] }, overdueNotifiedAt: null, ticket: { deletedAt: null } },
      select: { id: true, number: true, title: true, teamId: true, assignedAgentId: true, ticketId: true, ticket: { select: { number: true } } },
      take: batch,
    });
    for (const task of overdueTasks) {
      await safely(async () => {
        await transaction(async (tx) => {
          const claimed = await tx.ticketTask.updateMany({ where: { id: task.id, overdueNotifiedAt: null }, data: { overdueNotifiedAt: now } });
          if (claimed.count !== 1) return;
          await tx.taskHistory.create({ data: { taskId: task.id, actorId: null, action: "OVERDUE", newValue: "Task is overdue" } });
          const to = [...(task.assignedAgentId ? [task.assignedAgentId] : await teamMemberIds(tx, task.teamId)), ...(await teamMemberIds(tx, task.teamId, true))];
          await notifyUsers(tx, to, {
            type: "TASK_OVERDUE", title: `Task overdue: ${task.number}`, body: task.title, ticketId: task.ticketId,
            link: `/admin/tickets/${task.ticket.number}?task=${task.number}`,
          });
        });
        r.tasksOverdue++;
      });
    }

    // 4. Auto-close resolved tickets after the configured number of days.
    const settings = await getSettings(db);
    const days = settings["tickets.autoCloseResolvedDays"];
    if (days > 0) {
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      const resolved = await db.ticket.findMany({
        where: { deletedAt: null, status: { kind: "RESOLVED" }, resolvedAt: { lt: cutoff } },
        select: { id: true, number: true, subject: true, statusId: true, requesterId: true, status: { select: { name: true } } },
        take: batch,
      });
      for (const t of resolved) {
        await safely(async () => {
          const tr = await db.workflowTransition.findFirst({
            where: { fromStatusId: t.statusId, toStatus: { kind: "CLOSED", isActive: true } }, include: { toStatus: true },
          });
          if (!tr) return;
          await transaction(async (tx) => {
            const moved = await tx.ticket.updateMany({ where: { id: t.id, statusId: t.statusId }, data: { statusId: tr.toStatusId, closedAt: now } });
            if (moved.count !== 1) return;
            const reason = `Auto-closed after ${days} day(s) in ${t.status.name}`;
            await tx.ticketHistory.create({ data: { ticketId: t.id, actorId: null, action: "STATUS_CHANGED", field: "status", oldValue: t.status.name, newValue: tr.toStatus.name, reason } });
            await audit(tx, null, { action: "STATUS_CHANGED", entityType: "Ticket", entityId: t.id, ticketId: t.id, oldValue: { status: t.status.name }, newValue: { status: tr.toStatus.name, reason } });
            await notifyUsers(tx, [t.requesterId], { type: "TICKET_CLOSED", title: `${t.number} was closed automatically`, body: reason, ticketId: t.id, link: `/tickets/${t.number}` });
          });
          r.autoClosed++;
        });
      }
    }
  } finally {
    await releaseLease(db, holder).catch(() => {});
  }
  r.durationMs = Date.now() - started;
  return r;
}
