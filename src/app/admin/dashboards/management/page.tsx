import { requireAdminPortal } from "@/server/auth/get-actor";
import { getAging, getOverview, getSlaPerformance, drillHref, canDrillDown } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { KpiCard } from "@/components/dashboard/kpi";
import { BarList, StackedColumns, TrendLines } from "@/components/dashboard/charts";
import { BreakdownTable, ComplianceMeter, Panel } from "@/components/dashboard/widgets";
import { Alert } from "@/components/ui/misc";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/i18n/server";

export const generateMetadata = pageTitle("managementDashboard");

export default async function ManagementDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [td, fmt] = await Promise.all([getTranslations("dash"), getFormat()]);
  const dur = (m: number | null) => (m == null ? "—" : fmt.duration(m));
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "management", params);
  const [o, sla, aging] = await Promise.all([getOverview(actor, filters), getSlaPerformance(actor, filters), getAging(actor, filters)]);
  const k = o.kpis;
  const drill = canDrillDown(actor);
  const d = (extra: Record<string, string> = {}, dates = true) => (drill ? drillHref(filters, extra, dates) : undefined);
  return (
    <DashboardFrame actor={actor} current="management" title={td("managementDashboard")} description={td("organisationWideServiceDeskPerformance")}
      params={params} options={options} filters={filters}>
      {o.capped && <Alert variant="warning">{td("largeResultSetFiguresAreBased")}</Alert>}
      <p className="text-xs text-muted-foreground">{td.rich("volumeNote", { b: (c) => <strong>{c}</strong> })}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" data-testid="kpis">
        <KpiCard label={td("totalTickets")} value={k.total} href={d()} />
        <KpiCard label={td("new")} value={k.new} />
        <KpiCard label={td("open")} value={k.open} />
        <KpiCard label={td("inProgress")} value={k.inProgress} />
        <KpiCard label={td("waiting")} value={k.waiting} />
        <KpiCard label={td("resolved_")} value={k.resolved} />
        <KpiCard label={td("closed")} value={k.closed} />
        <KpiCard label={td("overdue")} value={k.overdue} tone="danger" />
        <KpiCard label={td("slaBreached")} value={k.slaBreached} tone="danger" />
        <KpiCard label={td("unassigned")} value={k.unassigned} tone="danger" />
        <KpiCard label={td("avgResponse")} value={dur(k.avgResponseMin)} hint={td("medianValue", { v: dur(k.medianResponseMin) })} />
        <KpiCard label={td("avgResolution")} value={dur(k.avgResolutionMin)} hint={td("medianValue", { v: dur(k.medianResolutionMin) })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ComplianceMeter label={td("resolutionSlaCompliance")} value={k.slaCompliance} hint={td("resolvedWithSlaCount", { n: k.resolvedWithSla })} />
        <ComplianceMeter label={td("responseSlaCompliance")} value={k.responseCompliance} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={td("ticketTrend")} description={td("createdVsResolvedPer", { g: td(`gran.${o.window.granularity}`) })}>
          <TrendLines data={o.trend} series={[{ key: td("created"), label: "Created" }, { key: td("resolved"), label: td("resolved_") }]} />
        </Panel>
        <Panel title={td("slaPerformance")} description={td("resolutionResponseCompliancePerPeriod")}>
          <TrendLines data={sla.trend} percent series={[{ key: "resolutionCompliance", label: "Resolution" }, { key: "responseCompliance", label: "Response" }]} />
        </Panel>
        <Panel title={td("ticketsByStatus")}>
          <BarList data={o.byStatus} useEntityColor />
          <BreakdownTable rows={o.byStatus} label={td("status")} swatch />
        </Panel>
        <Panel title={td("ticketsByPriority")}>
          <BarList data={o.byPriority} />
          <BreakdownTable rows={o.byPriority} label={td("priority")} />
        </Panel>
        <Panel title={td("ticketsByCategory")}><BarList data={o.byCategory.slice(0, 10)} /><BreakdownTable rows={o.byCategory} label={td("category")} /></Panel>
        <Panel title={td("ticketsBySubcategory")} description={td("top10")}><BarList data={o.bySubcategory.slice(0, 10)} /><BreakdownTable rows={o.bySubcategory.slice(0, 10)} label={td("subcategory")} total={k.total} /></Panel>
        <Panel title={td("ticketsBySupportTeam")}><BarList data={o.byTeam} /><BreakdownTable rows={o.byTeam} label={td("team")} /></Panel>
        <Panel title={td("ticketsByBranch")}><BarList data={o.byBranch.slice(0, 10)} /><BreakdownTable rows={o.byBranch} label={td("branch")} /></Panel>
        <Panel title={td("ticketAging")} description={td("openByAgePriority", { n: aging.totalOpen })}>
          <StackedColumns data={aging.buckets.map((b) => ({ label: b.label, ...Object.fromEntries(aging.priorities.map((p) => [p, b.byPriority[p] ?? 0])) }))} keys={aging.priorities} />
        </Panel>
        <Panel title={td("departmentBreakdown")}><BreakdownTable rows={o.byDepartment} label={td("department")} /></Panel>
      </div>
    </DashboardFrame>
  );
}
