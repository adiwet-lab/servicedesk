import { requireAdminPortal } from "@/server/auth/get-actor";
import { getAging, getOverview, getSlaPerformance, drillHref, canDrillDown } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { KpiCard } from "@/components/dashboard/kpi";
import { BarList, StackedColumns, TrendLines } from "@/components/dashboard/charts";
import { BreakdownTable, ComplianceMeter, Panel, formatDuration } from "@/components/dashboard/widgets";
import { Alert } from "@/components/ui/misc";

export const metadata = { title: "Management Dashboard" };

export default async function ManagementDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "management", params);
  const [o, sla, aging] = await Promise.all([getOverview(actor, filters), getSlaPerformance(actor, filters), getAging(actor, filters)]);
  const k = o.kpis;
  const drill = canDrillDown(actor);
  const d = (extra: Record<string, string> = {}, dates = true) => (drill ? drillHref(filters, extra, dates) : undefined);
  return (
    <DashboardFrame actor={actor} current="management" title="Management Dashboard" description="Organisation-wide service desk performance."
      params={params} options={options} filters={filters}>
      {o.capped && <Alert variant="warning">Large result set — figures are based on the first 50,000 tickets. Narrow the filters for exact numbers.</Alert>}
      <p className="text-xs text-muted-foreground">Volume figures count tickets <strong>created</strong> in the period (current status). Compliance and average times use tickets <strong>resolved</strong> in the period.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" data-testid="kpis">
        <KpiCard label="Total Tickets" value={k.total} href={d()} />
        <KpiCard label="New" value={k.new} />
        <KpiCard label="Open" value={k.open} />
        <KpiCard label="In Progress" value={k.inProgress} />
        <KpiCard label="Waiting" value={k.waiting} />
        <KpiCard label="Resolved" value={k.resolved} />
        <KpiCard label="Closed" value={k.closed} />
        <KpiCard label="Overdue" value={k.overdue} tone="danger" />
        <KpiCard label="SLA Breached" value={k.slaBreached} tone="danger" />
        <KpiCard label="Unassigned" value={k.unassigned} tone="danger" />
        <KpiCard label="Avg Response" value={formatDuration(k.avgResponseMin)} hint={`median ${formatDuration(k.medianResponseMin)}`} />
        <KpiCard label="Avg Resolution" value={formatDuration(k.avgResolutionMin)} hint={`median ${formatDuration(k.medianResolutionMin)}`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ComplianceMeter label="Resolution SLA compliance" value={k.slaCompliance} hint={`${k.resolvedWithSla} resolved with SLA`} />
        <ComplianceMeter label="Response SLA compliance" value={k.responseCompliance} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Ticket trend" description={`Created vs resolved per ${o.window.granularity}`}>
          <TrendLines data={o.trend} series={[{ key: "created", label: "Created" }, { key: "resolved", label: "Resolved" }]} />
        </Panel>
        <Panel title="SLA performance" description="Resolution & response compliance per period">
          <TrendLines data={sla.trend} percent series={[{ key: "resolutionCompliance", label: "Resolution" }, { key: "responseCompliance", label: "Response" }]} />
        </Panel>
        <Panel title="Tickets by status">
          <BarList data={o.byStatus} useEntityColor />
          <BreakdownTable rows={o.byStatus} label="Status" swatch />
        </Panel>
        <Panel title="Tickets by priority">
          <BarList data={o.byPriority} />
          <BreakdownTable rows={o.byPriority} label="Priority" />
        </Panel>
        <Panel title="Tickets by category"><BarList data={o.byCategory.slice(0, 10)} /><BreakdownTable rows={o.byCategory} label="Category" /></Panel>
        <Panel title="Tickets by subcategory" description="Top 10"><BarList data={o.bySubcategory.slice(0, 10)} /><BreakdownTable rows={o.bySubcategory.slice(0, 10)} label="Subcategory" total={k.total} /></Panel>
        <Panel title="Tickets by support team"><BarList data={o.byTeam} /><BreakdownTable rows={o.byTeam} label="Team" /></Panel>
        <Panel title="Tickets by branch"><BarList data={o.byBranch.slice(0, 10)} /><BreakdownTable rows={o.byBranch} label="Branch" /></Panel>
        <Panel title="Ticket aging" description={`${aging.totalOpen} open tickets by age and priority (current backlog)`}>
          <StackedColumns data={aging.buckets.map((b) => ({ label: b.label, ...Object.fromEntries(aging.priorities.map((p) => [p, b.byPriority[p] ?? 0])) }))} keys={aging.priorities} />
        </Panel>
        <Panel title="Department breakdown"><BreakdownTable rows={o.byDepartment} label="Department" /></Panel>
      </div>
    </DashboardFrame>
  );
}
