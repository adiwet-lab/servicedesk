import Link from "next/link";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getAging, getOverview, getSlaPerformance, getWorkload, isOrgWide } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { KpiCard } from "@/components/dashboard/kpi";
import { GroupedBars, StackedColumns } from "@/components/dashboard/charts";
import { ComplianceMeter, Panel, formatDuration } from "@/components/dashboard/widgets";
import { WorkloadTable } from "@/components/dashboard/workload-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert } from "@/components/ui/misc";

export const metadata = { title: "Team Dashboard" };

export default async function TeamDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "team", params);
  // Team leads default to their (first) led team; admins pick any team (all teams when none chosen).
  const team = filters.team ?? (isOrgWide(actor) ? undefined : actor.leadTeamIds[0] ?? actor.teamIds[0]);
  const f = { ...filters, team };
  const [o, w, aging, sla] = await Promise.all([getOverview(actor, f), getWorkload(actor, f), getAging(actor, f), getSlaPerformance(actor, f)]);
  const teamName = team ? options.teams.find((t) => t.id === team)?.name ?? "Team" : "All teams";
  const tr = w.teams.find((t) => t.teamId === team);
  return (
    <DashboardFrame actor={actor} current="team" title={`Team Dashboard — ${teamName}`} description="Queue, workload and SLA of the team."
      params={params} options={options} filters={filters}>
      {!team && <Alert>Select a team in the filter bar to focus on one team; showing all teams you can access.</Alert>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="team-kpis">
        <KpiCard label="Open (backlog)" value={tr?.open ?? w.teams.reduce((a, t) => a + t.open, 0)} href={tr?.href} />
        <KpiCard label="Unassigned" value={tr?.unassigned ?? w.teams.reduce((a, t) => a + t.unassigned, 0)} tone="danger" />
        <KpiCard label="Overdue" value={tr?.overdue ?? w.teams.reduce((a, t) => a + t.overdue, 0)} tone="danger" />
        <KpiCard label="SLA breached (open)" value={tr?.breached ?? w.teams.reduce((a, t) => a + t.breached, 0)} tone="danger" />
        <KpiCard label="Created in period" value={o.kpis.total} />
        <KpiCard label="Avg resolution" value={formatDuration(o.kpis.avgResolutionMin)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ComplianceMeter label="Team resolution SLA compliance" value={sla.resolutionCompliance} hint={`${sla.resolvedWithSla} resolved with SLA`} />
        <ComplianceMeter label="Team response SLA compliance" value={sla.responseCompliance} />
      </div>
      <Panel title="Agent workload" description="Open tickets and tasks per team member (current); completed = resolved in period">
        <GroupedBars data={w.agents.map((a) => ({ name: a.name, assigned: a.assigned, openTasks: a.openTasks, overdueTasks: a.overdueTasks }))}
          series={[{ key: "assigned", label: "Assigned tickets" }, { key: "openTasks", label: "Open tasks" }, { key: "overdueTasks", label: "Overdue tasks" }]} />
        <WorkloadTable rows={w.agents} />
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Ticket aging" description={`${aging.totalOpen} open tickets`}>
          <StackedColumns data={aging.buckets.map((b) => ({ label: b.label, ...Object.fromEntries(aging.priorities.map((p) => [p, b.byPriority[p] ?? 0])) }))} keys={aging.priorities} />
        </Panel>
        <Panel title="Open tickets by SLA state">
          <Table className="text-sm">
            <TableBody>
              {([["ON_TRACK", "On track"], ["WARNING", "Warning"], ["BREACHED", "Breached"], ["PAUSED", "Paused"], ["NONE", "No SLA"]] as const).map(([k, l]) => (
                <TableRow key={k}><TableCell>{l}</TableCell><TableCell className="text-right tabular-nums font-medium">{sla.openStates[k]}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
      <Panel title="Oldest open tickets">
        <Table className="text-sm">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Ticket</TableHead><TableHead>Age</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Agent</TableHead></TableRow></TableHeader>
          <TableBody>
            {aging.oldest.map((t) => (
              <TableRow key={t.number}>
                <TableCell><Link href={`/admin/tickets/${t.number}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link> <span className="text-muted-foreground">{t.subject}</span></TableCell>
                <TableCell className="tabular-nums">{t.ageDays}d</TableCell><TableCell>{t.priority}</TableCell><TableCell>{t.status}</TableCell><TableCell>{t.agent ?? "Unassigned"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </DashboardFrame>
  );
}
