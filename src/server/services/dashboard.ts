import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { canAny } from "@/server/authz/guards";
import { AuthorizationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { ticketScopeWhere } from "@/server/authz/scope";
import { ACTIVE_KINDS } from "@/server/domain/workflow";

/**
 * Support/management dashboard statistics, always within the actor's data scope.
 * Dashboard viewers (dashboard.management) see organisation-wide figures.
 */
export async function getDashboardStats(actor: Actor, opts: { days?: number } = {}) {
  if (!canAny(actor, [P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL])) throw new AuthorizationError();
  const management = actor.permissions.has(P.DASHBOARD_MANAGEMENT);
  const scope: Prisma.TicketWhereInput = management ? { deletedAt: null } : ticketScopeWhere(actor);
  const days = opts.days ?? 30;
  const since = new Date(Date.now() - days * 86400000);
  const now = new Date();
  const active = { status: { kind: { in: ACTIVE_KINDS } } };

  const [byStatus, byCategory, byTeam, byPriority, overdue, statuses, categories, teams, priorities, recent, resolved, unassigned, breachedCount] = await Promise.all([
    prisma.ticket.groupBy({ by: ["statusId"], where: scope, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["categoryId"], where: scope, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["ownerTeamId"], where: scope, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priorityId"], where: { AND: [scope, active] }, _count: { _all: true } }),
    prisma.ticket.count({ where: { AND: [scope, active, { resolutionDueAt: { lt: now }, slaPausedAt: null }] } }),
    prisma.ticketStatus.findMany({ orderBy: { order: "asc" } }),
    prisma.category.findMany({ where: { parentId: null }, select: { id: true, name: true } }),
    prisma.supportTeam.findMany({ select: { id: true, name: true } }),
    prisma.priority.findMany({ orderBy: { level: "asc" } }),
    prisma.ticket.findMany({ where: { AND: [scope, { createdAt: { gte: since } }] }, select: { createdAt: true, resolvedAt: true } }),
    prisma.ticket.findMany({ where: { AND: [scope, { resolvedAt: { not: null } }] }, select: { createdAt: true, resolvedAt: true, resolutionDueAt: true, firstResponseAt: true, responseDueAt: true, resolutionTargetMin: true, resolutionBreached: true }, take: 5000, orderBy: { resolvedAt: "desc" } }),
    prisma.ticket.count({ where: { AND: [scope, active, { assignedAgentId: null }] } }),
    // SLA breached = any clock breached (recorded by the SLA job / at resolution) or open & past due while running.
    prisma.ticket.count({ where: { AND: [scope, { OR: [{ responseBreached: true }, { resolutionBreached: true }, { AND: [active, { resolutionDueAt: { lt: now }, slaPausedAt: null }] }] }] } }),
  ]);

  const sMap = new Map(statuses.map((s) => [s.id, s]));
  const statusCounts = statuses.map((s) => ({ name: s.name, color: s.color, kind: s.kind, count: byStatus.find((g) => g.statusId === s.id)?._count._all ?? 0 }));
  const kindCount = (k: string) => byStatus.filter((g) => sMap.get(g.statusId)?.kind === k).reduce((a, g) => a + g._count._all, 0);
  const total = byStatus.reduce((a, g) => a + g._count._all, 0);

  // Compliance = resolved within the (pause-aware, business-hours) resolution SLA / resolved with an SLA.
  const withSla = resolved.filter((r) => r.resolutionTargetMin != null || r.resolutionDueAt).length;
  const withinSla = resolved.filter((r) => (r.resolutionTargetMin != null || r.resolutionDueAt) && !r.resolutionBreached).length;
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const avgResolutionMin = avg(resolved.map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 60000));
  const avgResponseMin = avg(resolved.filter((r) => r.firstResponseAt).map((r) => (r.firstResponseAt!.getTime() - r.createdAt.getTime()) / 60000));

  // Daily trend
  const trend: { date: string; created: number; resolved: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    trend.push({ date: d.slice(5), created: 0, resolved: 0 });
  }
  const idx = (dt: Date) => trend.findIndex((t) => t.date === dt.toISOString().slice(5, 10));
  for (const r of recent) {
    const i = idx(r.createdAt);
    if (i >= 0) trend[i]!.created++;
  }
  for (const r of resolved) {
    if (r.resolvedAt! >= since) {
      const i = idx(r.resolvedAt!);
      if (i >= 0) trend[i]!.resolved++;
    }
  }

  return {
    management,
    kpis: {
      total, new: kindCount("NEW"), open: kindCount("NEW") + kindCount("OPEN") + kindCount("WAITING"), inProgress: kindCount("OPEN"),
      waiting: kindCount("WAITING"), resolved: kindCount("RESOLVED"), closed: kindCount("CLOSED"), overdue, slaBreached: breachedCount,
      unassigned, slaCompliance: withSla ? Math.round((withinSla / withSla) * 1000) / 10 : null, avgResponseMin, avgResolutionMin,
    },
    statusCounts,
    categoryCounts: byCategory.map((g) => ({ name: categories.find((c) => c.id === g.categoryId)?.name ?? "—", count: g._count._all })).sort((a, b) => b.count - a.count),
    teamCounts: byTeam.map((g) => ({ name: teams.find((t) => t.id === g.ownerTeamId)?.name ?? "Unrouted", count: g._count._all })).sort((a, b) => b.count - a.count),
    priorityCounts: priorities.map((p) => ({ name: `${p.code} ${p.name}`, color: p.color, count: byPriority.find((g) => g.priorityId === p.id)?._count._all ?? 0 })),
    trend,
  };
}
