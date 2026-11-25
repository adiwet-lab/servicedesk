import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { requirePermission } from "@/server/authz/guards";
import { NotFoundError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { ageInDays, average, compliance } from "@/server/domain/analytics";
import { buildWhere, getSlaPerformance, getWorkload, type AnalyticsFilters } from "./analytics";

export const REPORT_TYPES = {
  tickets: { label: "Ticket detail", description: "One row per ticket created in the period, with SLA outcome and timings." },
  sla: { label: "SLA compliance", description: "Response and resolution SLA outcome per ticket created in the period." },
  agents: { label: "Agent performance", description: "Current workload and tickets completed in the period per agent." },
  teams: { label: "Team performance", description: "Backlog, breaches, completed tickets and SLA compliance per team." },
  categories: { label: "Category summary", description: "Volume, average resolution and compliance per category / subcategory." },
} as const;
export type ReportType = keyof typeof REPORT_TYPES;
export const MAX_REPORT_ROWS = 50_000;

export interface ReportResult { type: ReportType; headers: string[]; rows: (string | number | null)[][]; truncated: boolean }

const iso = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : null);
const mins = (a: Date | null, b: Date | null) => (a && b ? Math.round((b.getTime() - a.getTime()) / 60000) : null);

function slaOutcome(target: number | null, metAt: Date | null, breached: boolean, paused: boolean, dueAt: Date | null, now: Date) {
  if (target == null) return "No SLA";
  if (metAt) return breached ? "Met late" : "Met";
  if (breached || (!paused && dueAt && dueAt < now)) return "Breached";
  return paused ? "Paused" : "Open";
}

/**
 * Runs a report within the actor's data scope (org-wide only for management roles).
 * Never includes message bodies or internal notes.
 */
export async function runReport(actor: Actor, type: string, f: AnalyticsFilters, limit = MAX_REPORT_ROWS, now = new Date()): Promise<ReportResult> {
  requirePermission(actor, P.REPORT_EXPORT);
  if (!(type in REPORT_TYPES)) throw new NotFoundError("Unknown report type.");
  const t = type as ReportType;

  if (t === "tickets" || t === "sla") {
    const rows = await prisma.ticket.findMany({
      where: buildWhere(actor, f, "createdAt", now), take: limit + 1, orderBy: { createdAt: "asc" },
      include: {
        category: { select: { name: true, nameTh: true } }, subcategory: { select: { name: true, nameTh: true } }, priority: { select: { code: true } },
        status: { select: { name: true, nameTh: true, kind: true } }, requester: { select: { displayName: true, email: true } }, company: { select: { name: true } },
        department: { select: { name: true, nameTh: true } }, branch: { select: { name: true, nameTh: true } }, ownerTeam: { select: { name: true, nameTh: true } }, assignedAgent: { select: { displayName: true } },
      },
    });
    const truncated = rows.length > limit;
    const data = rows.slice(0, limit);
    if (t === "tickets") {
      return {
        type: t, truncated,
        headers: ["Ticket", "Subject", "Category", "Subcategory", "Requester", "Requester email", "Company", "Department", "Branch", "Priority", "Status",
          "Team", "Agent", "Confidential", "Created", "Updated", "First response", "Resolved", "Closed", "Age (days)", "Response SLA", "Resolution SLA",
          "Response target (min)", "Resolution target (min)", "First response (min)", "Resolution (min)"],
        rows: data.map((r) => [
          r.number, r.subject, r.category.name, r.subcategory?.name ?? null, r.requester.displayName, r.requester.email, r.company?.name ?? null,
          r.department?.name ?? null, r.branch?.name ?? null, r.priority.code, r.status.name, r.ownerTeam?.name ?? null, r.assignedAgent?.displayName ?? null,
          r.isConfidential ? "Yes" : "No", iso(r.createdAt), iso(r.updatedAt), iso(r.firstResponseAt), iso(r.resolvedAt), iso(r.closedAt),
          ageInDays(r.createdAt, r.closedAt ?? r.resolvedAt ?? now),
          slaOutcome(r.responseTargetMin, r.firstResponseAt, r.responseBreached, !!r.slaPausedAt, r.responseDueAt, now),
          slaOutcome(r.resolutionTargetMin, r.resolvedAt, r.resolutionBreached, !!r.slaPausedAt, r.resolutionDueAt, now),
          r.responseTargetMin, r.resolutionTargetMin, mins(r.createdAt, r.firstResponseAt), mins(r.createdAt, r.resolvedAt),
        ]),
      };
    }
    return {
      type: t, truncated,
      headers: ["Ticket", "Priority", "Team", "Agent", "Status", "Created", "Response due", "First response", "Response SLA", "Resolution due", "Resolved",
        "Resolution SLA", "Paused (business min)", "Currently paused"],
      rows: data.map((r) => [
        r.number, r.priority.code, r.ownerTeam?.name ?? null, r.assignedAgent?.displayName ?? null, r.status.name, iso(r.createdAt), iso(r.responseDueAt),
        iso(r.firstResponseAt), slaOutcome(r.responseTargetMin, r.firstResponseAt, r.responseBreached, !!r.slaPausedAt, r.responseDueAt, now),
        iso(r.resolutionDueAt), iso(r.resolvedAt), slaOutcome(r.resolutionTargetMin, r.resolvedAt, r.resolutionBreached, !!r.slaPausedAt, r.resolutionDueAt, now),
        r.slaPausedMinutes, r.slaPausedAt && r.status.kind !== "RESOLVED" && r.status.kind !== "CLOSED" ? "Yes" : "No",
      ]),
    };
  }

  if (t === "agents") {
    const w = await getWorkload(actor, f, now);
    return {
      type: t, truncated: false,
      headers: ["Agent", "Teams", "Assigned (open)", "In progress", "Waiting", "Open tasks", "Overdue tasks", "Completed in period", "Avg resolution (min)"],
      rows: w.agents.map((a) => [a.name, a.teams, a.assigned, a.inProgress, a.waiting, a.openTasks, a.overdueTasks, a.completed, a.avgResolutionMin]),
    };
  }

  if (t === "teams") {
    const [w, sla] = await Promise.all([getWorkload(actor, f, now), getSlaPerformance(actor, f, now)]);
    return {
      type: t, truncated: false,
      headers: ["Team", "Open", "Unassigned", "Overdue", "SLA breached (open)", "Completed in period", "Resolved with SLA", "Resolution compliance %"],
      rows: w.teams.map((tm) => {
        const c = sla.byTeam.find((x) => x.id === tm.teamId);
        return [tm.name, tm.open, tm.unassigned, tm.overdue, tm.breached, tm.completed, c?.total ?? 0, c?.compliance ?? null];
      }),
    };
  }

  // categories
  const [created, resolved, cats] = await Promise.all([
    prisma.ticket.groupBy({ by: ["categoryId", "subcategoryId"], where: buildWhere(actor, f, "createdAt", now), _count: { _all: true } }),
    prisma.ticket.findMany({ where: buildWhere(actor, f, "resolvedAt", now), take: MAX_REPORT_ROWS,
      select: { categoryId: true, subcategoryId: true, createdAt: true, resolvedAt: true, resolutionTargetMin: true, resolutionBreached: true } }),
    prisma.category.findMany({ select: { id: true, name: true, nameTh: true } }),
  ]);
  const name = new Map(cats.map((c) => [c.id, c.name]));
  const keys = new Set([...created.map((c) => `${c.categoryId}|${c.subcategoryId ?? ""}`), ...resolved.map((r) => `${r.categoryId}|${r.subcategoryId ?? ""}`)]);
  const rows = [...keys].map((k) => {
    const [cat, sub] = k.split("|");
    const res = resolved.filter((r) => r.categoryId === cat && (r.subcategoryId ?? "") === sub);
    const withT = res.filter((r) => r.resolutionTargetMin != null);
    return [
      name.get(cat!) ?? cat!, sub ? name.get(sub) ?? sub : null,
      created.find((c) => c.categoryId === cat && (c.subcategoryId ?? "") === sub)?._count._all ?? 0,
      res.length, average(res.map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 60000)),
      compliance(withT.filter((r) => !r.resolutionBreached).length, withT.length),
    ] as (string | number | null)[];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1] ?? "").localeCompare(String(b[1] ?? "")));
  return { type: t, truncated: false, headers: ["Category", "Subcategory", "Created in period", "Resolved in period", "Avg resolution (min)", "Resolution compliance %"], rows };
}
