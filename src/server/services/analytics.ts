import { z } from "zod";
import type { Prisma, StatusKind } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can, canAny } from "@/server/authz/guards";
import { AuthorizationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { taskScopeWhere, ticketScopeWhere } from "@/server/authz/scope";
import { TASK_TERMINAL } from "@/server/domain/task-workflow";
import {
  AGING_BUCKETS, ageInDays, agingBucket, average, chooseGranularity, compliance, median, periodKey, periodKeys, periodLabel,
  type AgingKey,
} from "@/server/domain/analytics";

const ACTIVE: StatusKind[] = ["NEW", "OPEN", "WAITING"];
const ROW_CAP = 50_000;

// ───────────────────────────── Filters ─────────────────────────────

const optId = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().max(50).optional());
const optDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

export const analyticsFilterSchema = z.object({
  range: z.enum(["7d", "30d", "90d", "365d", "month", "custom"]).catch("30d"),
  from: optDate.catch(undefined),
  to: optDate.catch(undefined),
  company: optId.catch(undefined),
  department: optId.catch(undefined),
  branch: optId.catch(undefined),
  team: optId.catch(undefined),
  category: optId.catch(undefined),
  subcategory: optId.catch(undefined),
  priority: optId.catch(undefined),
  status: optId.catch(undefined),
  agent: optId.catch(undefined),
});
export type AnalyticsFilters = z.infer<typeof analyticsFilterSchema>;

export function parseAnalyticsFilters(raw: Record<string, string | undefined>): AnalyticsFilters {
  return analyticsFilterSchema.parse(raw ?? {});
}

/** Resolves the date window [from, to] for the filters. */
export function dateWindow(f: AnalyticsFilters, now = new Date()): { from: Date; to: Date; label: string } {
  const day = 86_400_000;
  if (f.range === "custom" && f.from) {
    const from = new Date(`${f.from}T00:00:00Z`);
    const to = f.to ? new Date(`${f.to}T23:59:59.999Z`) : now;
    return { from, to: to < from ? from : to, label: `${f.from} – ${f.to ?? "today"}` };
  }
  if (f.range === "month") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now, label: "Month to date" };
  }
  const days = { "7d": 7, "30d": 30, "90d": 90, "365d": 365, custom: 30, month: 30 }[f.range];
  return { from: new Date(now.getTime() - days * day), to: now, label: `Last ${days} days` };
}

// ───────────────────────────── Scope ─────────────────────────────

export function requireDashboardAccess(actor: Actor) {
  if (!canAny(actor, [P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL])) throw new AuthorizationError();
}

/** Organisation-wide figures for management viewers; everyone else is limited to their ticket scope. */
export function isOrgWide(actor: Actor) {
  return !isVendor(actor) && (can(actor, P.DASHBOARD_MANAGEMENT) || can(actor, P.TICKET_READ_ALL));
}

function scopeWhere(actor: Actor): Prisma.TicketWhereInput {
  return isOrgWide(actor) ? { deletedAt: null } : ticketScopeWhere(actor);
}

/** Dimension filters (no date). */
function dimensionWhere(f: AnalyticsFilters): Prisma.TicketWhereInput {
  return {
    ...(f.company ? { companyId: f.company } : {}),
    ...(f.department ? { departmentId: f.department } : {}),
    ...(f.branch ? { branchId: f.branch } : {}),
    ...(f.team ? { ownerTeamId: f.team } : {}),
    ...(f.category ? { categoryId: f.category } : {}),
    ...(f.subcategory ? { subcategoryId: f.subcategory } : {}),
    ...(f.priority ? { priorityId: f.priority } : {}),
    ...(f.status ? { statusId: f.status } : {}),
    ...(f.agent ? { assignedAgentId: f.agent === "none" ? null : f.agent } : {}),
  };
}

export function buildWhere(actor: Actor, f: AnalyticsFilters, dateField: "createdAt" | "resolvedAt" | null = "createdAt", now = new Date()): Prisma.TicketWhereInput {
  const parts: Prisma.TicketWhereInput[] = [scopeWhere(actor), dimensionWhere(f)];
  if (dateField) {
    const w = dateWindow(f, now);
    parts.push({ [dateField]: { gte: w.from, lte: w.to } });
  }
  return { AND: parts };
}

const activeWhere: Prisma.TicketWhereInput = { status: { kind: { in: ACTIVE } } };
const overdueWhere = (now: Date): Prisma.TicketWhereInput => ({ ...activeWhere, resolutionDueAt: { lt: now }, slaPausedAt: null });

/** Can the actor open the ticket list behind a figure? (Dashboard viewers see aggregates only.) */
export function canDrillDown(actor: Actor) {
  return canAny(actor, [P.TICKET_READ_TEAM, P.TICKET_READ_ALL]);
}

/** Ticket-list URL reproducing the filters (+ extra params) for drill-down. */
export function drillHref(f: AnalyticsFilters, extra: Record<string, string | undefined> = {}, withDates = true, now = new Date()) {
  const sp = new URLSearchParams({ view: "all" });
  const map: Record<string, string | undefined> = {
    company: f.company, department: f.department, branch: f.branch, team: f.team, subcategory: f.subcategory,
    category: f.category, priority: f.priority, status: f.status, agent: f.agent,
  };
  if (withDates) {
    const w = dateWindow(f, now);
    map.from = w.from.toISOString().slice(0, 10);
    map.to = w.to.toISOString().slice(0, 10);
  }
  for (const [k, v] of Object.entries({ ...map, ...extra })) if (v) sp.set(k, v);
  return `/admin/tickets?${sp}`;
}

// ───────────────────────────── Lookups ─────────────────────────────

async function names() {
  const [statuses, categories, teams, priorities, branches, departments, users] = await Promise.all([
    prisma.ticketStatus.findMany({ select: { id: true, name: true, color: true, kind: true, order: true } }),
    prisma.category.findMany({ select: { id: true, name: true, parentId: true } }),
    prisma.supportTeam.findMany({ select: { id: true, name: true } }),
    prisma.priority.findMany({ select: { id: true, code: true, name: true, color: true, level: true }, orderBy: { level: "asc" } }),
    prisma.branch.findMany({ select: { id: true, name: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ where: { teamMemberships: { some: {} } }, select: { id: true, displayName: true } }),
  ]);
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  return {
    statuses, priorities,
    status: byId(statuses), category: byId(categories), team: byId(teams), priority: byId(priorities),
    branch: byId(branches), department: byId(departments), user: byId(users),
  };
}

export interface BreakdownRow { id: string | null; name: string; count: number; color?: string; href?: string }

// ───────────────────────────── KPIs & breakdowns ─────────────────────────────

export async function getOverview(actor: Actor, f: AnalyticsFilters, now = new Date()) {
  requireDashboardAccess(actor);
  const created = buildWhere(actor, f, "createdAt", now);
  const resolvedW = buildWhere(actor, f, "resolvedAt", now);
  const window = dateWindow(f, now);
  const g = chooseGranularity(window.from, window.to);
  const n = await names();

  const [byStatus, byCategory, bySub, byTeam, byPriority, byBranch, byDept, overdue, breached, unassigned, resolvedRows, createdRows] = await Promise.all([
    prisma.ticket.groupBy({ by: ["statusId"], where: created, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["categoryId"], where: created, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["subcategoryId"], where: created, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["ownerTeamId"], where: created, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priorityId"], where: created, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["branchId"], where: created, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["departmentId"], where: created, _count: { _all: true } }),
    prisma.ticket.count({ where: { AND: [created, overdueWhere(now)] } }),
    prisma.ticket.count({ where: { AND: [created, { OR: [{ responseBreached: true }, { resolutionBreached: true }, overdueWhere(now)] }] } }),
    prisma.ticket.count({ where: { AND: [created, activeWhere, { assignedAgentId: null }] } }),
    prisma.ticket.findMany({
      where: resolvedW, take: ROW_CAP,
      select: { createdAt: true, resolvedAt: true, firstResponseAt: true, resolutionTargetMin: true, resolutionBreached: true, responseTargetMin: true, responseBreached: true },
    }),
    prisma.ticket.findMany({ where: created, take: ROW_CAP, select: { createdAt: true } }),
  ]);

  const kindCount = (k: StatusKind) => byStatus.filter((s) => n.status.get(s.statusId)?.kind === k).reduce((a, s) => a + s._count._all, 0);
  const total = byStatus.reduce((a, s) => a + s._count._all, 0);
  const inProgressCount = byStatus.filter((s) => n.status.get(s.statusId)?.kind === "OPEN").reduce((a, s) => a + s._count._all, 0);
  const withTarget = resolvedRows.filter((r) => r.resolutionTargetMin != null);
  const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60000;
  const respTimes = resolvedRows.filter((r) => r.firstResponseAt).map((r) => minutes(r.createdAt, r.firstResponseAt!));
  const resTimes = resolvedRows.map((r) => minutes(r.createdAt, r.resolvedAt!));

  const kpis = {
    total, new: kindCount("NEW"), open: kindCount("NEW") + kindCount("OPEN") + kindCount("WAITING"), inProgress: inProgressCount,
    waiting: kindCount("WAITING"), resolved: kindCount("RESOLVED"), closed: kindCount("CLOSED"), overdue, slaBreached: breached, unassigned,
    resolvedInPeriod: resolvedRows.length,
    resolvedWithSla: withTarget.length,
    slaCompliance: compliance(withTarget.filter((r) => !r.resolutionBreached).length, withTarget.length),
    responseCompliance: compliance(resolvedRows.filter((r) => r.responseTargetMin != null && !r.responseBreached).length, resolvedRows.filter((r) => r.responseTargetMin != null).length),
    avgResponseMin: average(respTimes), medianResponseMin: median(respTimes),
    avgResolutionMin: average(resTimes), medianResolutionMin: median(resTimes),
  };

  const drill = canDrillDown(actor);
  const rows = (groups: { _count: { _all: number } }[], key: string, label: (id: string | null) => string, color?: (id: string | null) => string | undefined, param?: string): BreakdownRow[] =>
    groups.map((gp) => {
      const id = (gp as unknown as Record<string, string | null>)[key] ?? null;
      return { id, name: label(id), count: gp._count._all, color: color?.(id), href: drill && param && id ? drillHref(f, { [param]: id }, true, now) : undefined };
    }).sort((a, b) => b.count - a.count);

  const statusRows = n.statuses.sort((a, b) => a.order - b.order).map((s) => ({
    id: s.id, name: s.name, color: s.color, count: byStatus.find((x) => x.statusId === s.id)?._count._all ?? 0,
    href: drill ? drillHref(f, { status: s.id }, true, now) : undefined,
  })).filter((r) => r.count > 0);

  // Trend: created vs resolved per period, no gaps.
  const keys = periodKeys(window.from, window.to, g);
  const createdBy = new Map<string, number>(), resolvedBy = new Map<string, number>();
  for (const r of createdRows) createdBy.set(periodKey(r.createdAt, g), (createdBy.get(periodKey(r.createdAt, g)) ?? 0) + 1);
  for (const r of resolvedRows) resolvedBy.set(periodKey(r.resolvedAt!, g), (resolvedBy.get(periodKey(r.resolvedAt!, g)) ?? 0) + 1);
  const trend = keys.map((k) => ({ period: periodLabel(k, g), key: k, created: createdBy.get(k) ?? 0, resolved: resolvedBy.get(k) ?? 0 }));

  return {
    window: { ...window, granularity: g },
    orgWide: isOrgWide(actor),
    capped: resolvedRows.length >= ROW_CAP || createdRows.length >= ROW_CAP,
    kpis,
    byStatus: statusRows,
    byPriority: n.priorities.map((p) => ({
      id: p.id, name: `${p.code} ${p.name}`, color: p.color, count: byPriority.find((x) => x.priorityId === p.id)?._count._all ?? 0,
      href: drill ? drillHref(f, { priority: p.id }, true, now) : undefined,
    })),
    byCategory: rows(byCategory, "categoryId", (id) => n.category.get(id ?? "")?.name ?? "—", undefined, "category"),
    bySubcategory: rows(bySub, "subcategoryId", (id) => (id ? n.category.get(id)?.name ?? "—" : "No subcategory"), undefined, "subcategory"),
    byTeam: rows(byTeam, "ownerTeamId", (id) => (id ? n.team.get(id)?.name ?? "—" : "Unrouted"), undefined, "team"),
    byBranch: rows(byBranch, "branchId", (id) => (id ? n.branch.get(id)?.name ?? "—" : "No branch"), undefined, "branch"),
    byDepartment: rows(byDept, "departmentId", (id) => (id ? n.department.get(id)?.name ?? "—" : "No department"), undefined, "department"),
    trend,
  };
}
export type Overview = Awaited<ReturnType<typeof getOverview>>;

// ───────────────────────────── SLA performance ─────────────────────────────

export async function getSlaPerformance(actor: Actor, f: AnalyticsFilters, now = new Date()) {
  requireDashboardAccess(actor);
  const window = dateWindow(f, now);
  const g = chooseGranularity(window.from, window.to);
  const n = await names();
  const resolved = await prisma.ticket.findMany({
    where: buildWhere(actor, f, "resolvedAt", now), take: ROW_CAP,
    select: { resolvedAt: true, priorityId: true, ownerTeamId: true, responseTargetMin: true, responseBreached: true, resolutionTargetMin: true, resolutionBreached: true },
  });
  const backlogWhere: Prisma.TicketWhereInput = { AND: [buildWhere(actor, f, null, now), activeWhere] };
  const backlog = await prisma.ticket.findMany({
    where: backlogWhere, take: ROW_CAP,
    select: { id: true, number: true, subject: true, resolutionDueAt: true, slaPausedAt: true, responseBreached: true, resolutionBreached: true,
      resolutionTargetMin: true, priorityId: true, ownerTeamId: true, assignedAgent: { select: { displayName: true } },
      slaEvents: { where: { type: "WARNING" }, select: { id: true }, take: 1 } },
  });

  const keys = periodKeys(window.from, window.to, g);
  const per = new Map(keys.map((k) => [k, { met: 0, breached: 0, respMet: 0, respBreached: 0 }]));
  for (const r of resolved) {
    const p = per.get(periodKey(r.resolvedAt!, g));
    if (!p) continue;
    if (r.resolutionTargetMin != null) {
      if (r.resolutionBreached) p.breached++;
      else p.met++;
    }
    if (r.responseTargetMin != null) {
      if (r.responseBreached) p.respBreached++;
      else p.respMet++;
    }
  }
  const trend = keys.map((k) => {
    const p = per.get(k)!;
    return { period: periodLabel(k, g), key: k, met: p.met, breached: p.breached,
      resolutionCompliance: compliance(p.met, p.met + p.breached), responseCompliance: compliance(p.respMet, p.respMet + p.respBreached) };
  });

  const groupCompliance = (key: "priorityId" | "ownerTeamId", label: (id: string | null) => string) => {
    const m = new Map<string | null, { met: number; total: number }>();
    for (const r of resolved) {
      if (r.resolutionTargetMin == null) continue;
      const e = m.get(r[key]) ?? { met: 0, total: 0 };
      e.total++;
      if (!r.resolutionBreached) e.met++;
      m.set(r[key], e);
    }
    return [...m.entries()].map(([id, e]) => ({ id, name: label(id), met: e.met, total: e.total, breached: e.total - e.met, compliance: compliance(e.met, e.total) }));
  };
  const byPriority = groupCompliance("priorityId", (id) => { const p = n.priority.get(id ?? ""); return p ? `${p.code} ${p.name}` : "—"; })
    .sort((a, b) => (n.priority.get(a.id ?? "")?.level ?? 99) - (n.priority.get(b.id ?? "")?.level ?? 99));
  const byTeam = groupCompliance("ownerTeamId", (id) => (id ? n.team.get(id)?.name ?? "—" : "Unrouted")).sort((a, b) => (a.compliance ?? 101) - (b.compliance ?? 101));

  const state = (t: (typeof backlog)[number]) =>
    t.resolutionTargetMin == null ? "NONE"
      : t.responseBreached || t.resolutionBreached || (!t.slaPausedAt && t.resolutionDueAt && t.resolutionDueAt < now) ? "BREACHED"
      : t.slaPausedAt ? "PAUSED" : t.slaEvents.length ? "WARNING" : "ON_TRACK";
  const openStates = { ON_TRACK: 0, WARNING: 0, BREACHED: 0, PAUSED: 0, NONE: 0 };
  for (const t of backlog) openStates[state(t)]++;
  const breachedOpen = backlog.filter((t) => state(t) === "BREACHED")
    .sort((a, b) => (a.resolutionDueAt?.getTime() ?? 0) - (b.resolutionDueAt?.getTime() ?? 0)).slice(0, 15)
    .map((t) => ({ number: t.number, subject: t.subject, dueAt: t.resolutionDueAt, agent: t.assignedAgent?.displayName ?? null,
      team: t.ownerTeamId ? n.team.get(t.ownerTeamId)?.name ?? "—" : "Unrouted", priority: n.priority.get(t.priorityId)?.code ?? "" }));

  const withTarget = resolved.filter((r) => r.resolutionTargetMin != null);
  return {
    window: { ...window, granularity: g },
    resolutionCompliance: compliance(withTarget.filter((r) => !r.resolutionBreached).length, withTarget.length),
    responseCompliance: compliance(resolved.filter((r) => r.responseTargetMin != null && !r.responseBreached).length, resolved.filter((r) => r.responseTargetMin != null).length),
    resolvedWithSla: withTarget.length,
    trend, byPriority, byTeam, openStates, breachedOpen,
  };
}

// ───────────────────────────── Aging ─────────────────────────────

export async function getAging(actor: Actor, f: AnalyticsFilters, now = new Date()) {
  requireDashboardAccess(actor);
  const n = await names();
  const rows = await prisma.ticket.findMany({
    where: { AND: [buildWhere(actor, f, null, now), activeWhere] }, take: ROW_CAP,
    select: { id: true, number: true, subject: true, createdAt: true, priorityId: true, ownerTeamId: true, statusId: true, assignedAgent: { select: { displayName: true } } },
  });
  const drill = canDrillDown(actor);
  const buckets = AGING_BUCKETS.map((b) => ({ key: b.key as AgingKey, label: b.label, total: 0, byPriority: {} as Record<string, number>,
    href: drill ? drillHref(f, { aging: b.key }, false, now) : undefined }));
  for (const r of rows) {
    const b = buckets.find((x) => x.key === agingBucket(ageInDays(r.createdAt, now)))!;
    b.total++;
    const code = n.priority.get(r.priorityId)?.code ?? "?";
    b.byPriority[code] = (b.byPriority[code] ?? 0) + 1;
  }
  const oldest = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, 10).map((r) => ({
    number: r.number, subject: r.subject, ageDays: ageInDays(r.createdAt, now), priority: n.priority.get(r.priorityId)?.code ?? "",
    status: n.status.get(r.statusId)?.name ?? "", team: r.ownerTeamId ? n.team.get(r.ownerTeamId)?.name ?? "—" : "Unrouted",
    agent: r.assignedAgent?.displayName ?? null,
  }));
  return {
    totalOpen: rows.length,
    priorities: n.priorities.map((p) => p.code),
    buckets,
    oldest,
    avgAgeDays: rows.length ? Math.round((rows.reduce((a, r) => a + ageInDays(r.createdAt, now), 0) / rows.length) * 10) / 10 : null,
  };
}

// ───────────────────────────── Workload ─────────────────────────────

export interface AgentWorkloadRow {
  agentId: string; name: string; teams: string; assigned: number; inProgress: number; waiting: number;
  openTasks: number; overdueTasks: number; completed: number; avgResolutionMin: number | null; href?: string;
}

export async function getWorkload(actor: Actor, f: AnalyticsFilters, now = new Date()) {
  requireDashboardAccess(actor);
  const orgWide = isOrgWide(actor);
  const teamFilter = f.team ? [f.team] : orgWide ? null : actor.teamIds;
  const members = await prisma.teamMember.findMany({
    where: { ...(teamFilter ? { teamId: { in: teamFilter } } : {}), team: { isActive: true, deletedAt: null }, user: { status: "ACTIVE", deletedAt: null } },
    select: { userId: true, user: { select: { displayName: true } }, team: { select: { name: true } } },
  });
  const agents = new Map<string, { name: string; teams: string[] }>();
  for (const m of members) {
    const a = agents.get(m.userId) ?? { name: m.user.displayName, teams: [] };
    a.teams.push(m.team.name);
    agents.set(m.userId, a);
  }
  if (!orgWide && !agents.has(actor.id) && actor.teamIds.length === 0) agents.set(actor.id, { name: actor.displayName, teams: [] });
  const ids = [...agents.keys()];
  const dims = buildWhere(actor, { ...f, agent: undefined }, null, now);
  const resolvedW = buildWhere(actor, { ...f, agent: undefined }, "resolvedAt", now);
  const taskScope = orgWide ? {} : taskScopeWhere(actor);

  const [openByKind, statuses, tasksOpen, tasksOverdue, resolved] = await Promise.all([
    prisma.ticket.groupBy({ by: ["assignedAgentId", "statusId"], where: { AND: [dims, activeWhere, { assignedAgentId: { in: ids } }] }, _count: { _all: true } }),
    prisma.ticketStatus.findMany({ select: { id: true, kind: true } }),
    prisma.ticketTask.groupBy({ by: ["assignedAgentId"], where: { AND: [taskScope, { assignedAgentId: { in: ids }, status: { notIn: TASK_TERMINAL } }] }, _count: { _all: true } }),
    prisma.ticketTask.groupBy({ by: ["assignedAgentId"], where: { AND: [taskScope, { assignedAgentId: { in: ids }, status: { notIn: TASK_TERMINAL }, dueDate: { lt: now } }] }, _count: { _all: true } }),
    prisma.ticket.findMany({ where: { AND: [resolvedW, { assignedAgentId: { in: ids } }] }, take: ROW_CAP, select: { assignedAgentId: true, createdAt: true, resolvedAt: true } }),
  ]);
  const kind = new Map(statuses.map((s) => [s.id, s.kind]));
  const drill = canDrillDown(actor);
  const rows: AgentWorkloadRow[] = ids.map((id) => {
    const mine = openByKind.filter((g) => g.assignedAgentId === id);
    const sum = (pred: (k: StatusKind | undefined) => boolean) => mine.filter((g) => pred(kind.get(g.statusId))).reduce((a, g) => a + g._count._all, 0);
    const done = resolved.filter((r) => r.assignedAgentId === id);
    return {
      agentId: id, name: agents.get(id)!.name, teams: agents.get(id)!.teams.join(", "),
      assigned: sum(() => true), inProgress: sum((k) => k === "OPEN"), waiting: sum((k) => k === "WAITING"),
      openTasks: tasksOpen.find((t) => t.assignedAgentId === id)?._count._all ?? 0,
      overdueTasks: tasksOverdue.find((t) => t.assignedAgentId === id)?._count._all ?? 0,
      completed: done.length,
      avgResolutionMin: average(done.map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 60000)),
      href: drill ? drillHref({ ...f, agent: id }, {}, false, now) : undefined,
    };
  }).sort((a, b) => b.assigned + b.openTasks - (a.assigned + a.openTasks) || a.name.localeCompare(b.name));

  // Team rows
  const teamIds = teamFilter ?? (await prisma.supportTeam.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true } })).map((t) => t.id);
  const [teamOpen, teamUnassigned, teamOverdue, teamBreached, teamDone, teamNames] = await Promise.all([
    prisma.ticket.groupBy({ by: ["ownerTeamId"], where: { AND: [dims, activeWhere, { ownerTeamId: { in: teamIds } }] }, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["ownerTeamId"], where: { AND: [dims, activeWhere, { ownerTeamId: { in: teamIds }, assignedAgentId: null }] }, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["ownerTeamId"], where: { AND: [dims, overdueWhere(now), { ownerTeamId: { in: teamIds } }] }, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["ownerTeamId"], where: { AND: [dims, activeWhere, { ownerTeamId: { in: teamIds } }, { OR: [{ responseBreached: true }, { resolutionBreached: true }] }] }, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["ownerTeamId"], where: { AND: [resolvedW, { ownerTeamId: { in: teamIds } }] }, _count: { _all: true } }),
    prisma.supportTeam.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } }),
  ]);
  const c = (xs: { ownerTeamId: string | null; _count: { _all: number } }[], id: string) => xs.find((x) => x.ownerTeamId === id)?._count._all ?? 0;
  const teams = teamNames.map((t) => ({
    teamId: t.id, name: t.name, open: c(teamOpen, t.id), unassigned: c(teamUnassigned, t.id), overdue: c(teamOverdue, t.id),
    breached: c(teamBreached, t.id), completed: c(teamDone, t.id), href: drill ? drillHref({ ...f, team: t.id }, {}, false, now) : undefined,
  })).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));

  return { agents: rows, teams, orgWide };
}

// ───────────────────────────── Agent ("My work") ─────────────────────────────

export async function getMyWork(actor: Actor, f: AnalyticsFilters, now = new Date()) {
  requireDashboardAccess(actor);
  const scope = ticketScopeWhere(actor);
  const resolvedW = { AND: [buildWhere(actor, { ...f, agent: undefined }, "resolvedAt", now), { assignedAgentId: actor.id }] };
  const [mine, statuses, tasks, resolved, nextDue] = await Promise.all([
    prisma.ticket.findMany({ where: { AND: [scope, activeWhere, { assignedAgentId: actor.id }] }, select: { statusId: true, createdAt: true, resolutionDueAt: true, slaPausedAt: true, responseBreached: true, resolutionBreached: true } }),
    prisma.ticketStatus.findMany({ select: { id: true, kind: true } }),
    prisma.ticketTask.findMany({ where: { AND: [taskScopeWhere(actor), { assignedAgentId: actor.id, status: { notIn: TASK_TERMINAL } }] }, select: { dueDate: true } }),
    prisma.ticket.findMany({ where: resolvedW, take: ROW_CAP, select: { createdAt: true, resolvedAt: true, resolutionTargetMin: true, resolutionBreached: true } }),
    prisma.ticket.findMany({
      where: { AND: [scope, activeWhere, { assignedAgentId: actor.id }] }, orderBy: { resolutionDueAt: { sort: "asc", nulls: "last" } }, take: 8,
      select: { number: true, subject: true, resolutionDueAt: true, slaPausedAt: true, priority: { select: { code: true, color: true } }, status: { select: { name: true, color: true } } },
    }),
  ]);
  const kind = new Map(statuses.map((s) => [s.id, s.kind]));
  const aging = AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: mine.filter((t) => agingBucket(ageInDays(t.createdAt, now)) === b.key).length }));
  const withTarget = resolved.filter((r) => r.resolutionTargetMin != null);
  return {
    assigned: mine.length,
    inProgress: mine.filter((t) => kind.get(t.statusId) === "OPEN").length,
    waiting: mine.filter((t) => kind.get(t.statusId) === "WAITING").length,
    overdue: mine.filter((t) => !t.slaPausedAt && t.resolutionDueAt && t.resolutionDueAt < now).length,
    breached: mine.filter((t) => t.responseBreached || t.resolutionBreached).length,
    openTasks: tasks.length,
    overdueTasks: tasks.filter((t) => t.dueDate && t.dueDate < now).length,
    resolved: resolved.length,
    compliance: compliance(withTarget.filter((r) => !r.resolutionBreached).length, withTarget.length),
    avgResolutionMin: average(resolved.map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 60000)),
    aging, nextDue,
  };
}

/** Options for the filter bar, limited to what the actor may see. */
export async function getFilterOptions(actor: Actor) {
  const orgWide = isOrgWide(actor);
  const [companies, departments, branches, teams, categories, priorities, statuses, agents] = await Promise.all([
    prisma.company.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true, company: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supportTeam.findMany({ where: { deletedAt: null, ...(orgWide ? {} : { id: { in: actor.teamIds } }) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { deletedAt: null }, select: { id: true, name: true, parentId: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.priority.findMany({ select: { id: true, code: true, name: true }, orderBy: { level: "asc" } }),
    prisma.ticketStatus.findMany({ select: { id: true, name: true }, orderBy: { order: "asc" } }),
    prisma.user.findMany({
      where: { deletedAt: null, teamMemberships: { some: orgWide ? {} : { teamId: { in: actor.teamIds } } } },
      select: { id: true, displayName: true }, orderBy: { displayName: "asc" },
    }),
  ]);
  return {
    companies, branches, teams, priorities, statuses, agents,
    departments: departments.map((d) => ({ id: d.id, name: `${d.name} (${d.company.name})` })),
    categories: categories.filter((c) => !c.parentId),
    subcategories: categories.filter((c) => c.parentId).map((c) => ({ id: c.id, name: c.name, parentId: c.parentId! })),
  };
}
export type FilterOptions = Awaited<ReturnType<typeof getFilterOptions>>;
