import Link from "next/link";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getMyWork } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { KpiCard } from "@/components/dashboard/kpi";
import { BarList } from "@/components/dashboard/charts";
import { ComplianceMeter, Panel, formatDuration } from "@/components/dashboard/widgets";
import { ColorBadge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "My Work" };

export default async function AgentDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "agent", params);
  const m = await getMyWork(actor, filters);
  const now = new Date();
  return (
    <DashboardFrame actor={actor} current="agent" title={`My work — ${actor.displayName}`} description="Your tickets, tasks and SLA. Period filters apply to resolved figures."
      params={params} options={options} filters={filters} hide={["agent", "company", "department"]}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8" data-testid="my-kpis">
        <KpiCard label="Assigned to me" value={m.assigned} href="/admin/tickets?view=assigned" />
        <KpiCard label="In progress" value={m.inProgress} />
        <KpiCard label="Waiting" value={m.waiting} />
        <KpiCard label="Overdue" value={m.overdue} tone="danger" />
        <KpiCard label="SLA breached" value={m.breached} tone="danger" />
        <KpiCard label="My open tasks" value={m.openTasks} href="/admin/tasks?view=my" />
        <KpiCard label="Overdue tasks" value={m.overdueTasks} tone="danger" href="/admin/tasks?view=overdue" />
        <KpiCard label="Resolved in period" value={m.resolved} hint={`avg ${formatDuration(m.avgResolutionMin)}`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <ComplianceMeter label="My resolution SLA compliance" value={m.compliance} />
        <Panel title="Age of my open tickets" className="xl:col-span-2"><BarList data={m.aging.map((a) => ({ name: a.label, count: a.count }))} valueLabel="Tickets" /></Panel>
      </div>
      <Panel title="Next due" description="My open tickets ordered by resolution due date">
        <Table className="text-sm">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Ticket</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Resolution due</TableHead></TableRow></TableHeader>
          <TableBody>
            {m.nextDue.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Nothing assigned to you.</TableCell></TableRow>}
            {m.nextDue.map((t) => (
              <TableRow key={t.number}>
                <TableCell><Link href={`/admin/tickets/${t.number}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link> {t.subject}</TableCell>
                <TableCell><ColorBadge color={t.priority.color}>{t.priority.code}</ColorBadge></TableCell>
                <TableCell><ColorBadge color={t.status.color}>{t.status.name}</ColorBadge></TableCell>
                <TableCell className={!t.slaPausedAt && t.resolutionDueAt && t.resolutionDueAt < now ? "font-semibold text-destructive" : ""}>
                  {t.slaPausedAt ? "Paused" : formatDateTime(t.resolutionDueAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </DashboardFrame>
  );
}
