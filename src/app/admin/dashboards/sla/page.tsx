import Link from "next/link";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getSlaPerformance } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { KpiCard } from "@/components/dashboard/kpi";
import { StackedColumns, TrendLines } from "@/components/dashboard/charts";
import { ComplianceMeter, Panel } from "@/components/dashboard/widgets";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/i18n/server";

export const generateMetadata = pageTitle("slaDashboard");

export default async function SlaDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [td, fmt] = await Promise.all([getTranslations("dash"), getFormat()]);
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "sla", params);
  const s = await getSlaPerformance(actor, filters);
  const ct = (rows: typeof s.byPriority, label: string) => (
    <Table className="text-sm">
      <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{label}</TableHead><TableHead className="text-right">{td("resolved")}</TableHead><TableHead className="text-right">{td("breached")}</TableHead><TableHead className="text-right">{td("compliance")}</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">{td("noTicketsWithAnSlaWere")}</TableCell></TableRow>}
        {rows.map((r) => (
          <TableRow key={r.id ?? r.name}>
            <TableCell>{r.name}</TableCell><TableCell className="text-right tabular-nums">{r.total}</TableCell>
            <TableCell className="text-right tabular-nums">{r.breached}</TableCell>
            <TableCell className="text-right tabular-nums font-medium">{r.compliance == null ? "—" : `${r.compliance}%`}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
  return (
    <DashboardFrame actor={actor} current="sla" title={td("slaDashboard")} description={td("complianceOfResolvedTicketsInThe")}
      params={params} options={options} filters={filters}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ComplianceMeter label={td("resolutionCompliance")} value={s.resolutionCompliance} hint={td("resolvedWithSlaCount", { n: s.resolvedWithSla })} />
        <ComplianceMeter label={td("responseCompliance")} value={s.responseCompliance} />
        <KpiCard label={td("openBreached")} value={s.openStates.BREACHED} tone="danger" />
        <KpiCard label={td("openWarningPaused")} value={`${s.openStates.WARNING} / ${s.openStates.PAUSED}`} hint={td("onTrackCount", { n: s.openStates.ON_TRACK })} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={td("complianceTrend")} description={td("perGranularity", { g: td(`gran.${s.window.granularity}`) })}>
          <TrendLines data={s.trend} percent series={[{ key: "resolutionCompliance", label: td("chart.resolution") }, { key: "responseCompliance", label: td("chart.response") }]} />
        </Panel>
        <Panel title={td("resolvedWithinOutsideSla")} description={td("resolutionClock")}>
          <StackedColumns data={s.trend.map((t) => ({ label: t.period, [td("chart.withinSla")]: t.met, [td("chart.breached")]: t.breached }))} keys={[td("chart.breached"), td("chart.withinSla")]} />
        </Panel>
        <Panel title={td("complianceByPriority")}>{ct(s.byPriority, td("priority"))}</Panel>
        <Panel title={td("complianceByTeam")} description={td("lowestFirst")}>{ct(s.byTeam, td("team"))}</Panel>
      </div>
      <Panel title={td("breachedOpenTickets")} description={td("oldestDueFirst")}>
        <Table className="text-sm" data-testid="breach-list">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{td("ticket")}</TableHead><TableHead>{td("priority")}</TableHead><TableHead>{td("team")}</TableHead><TableHead>{td("agent")}</TableHead><TableHead>{td("wasDue")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {s.breachedOpen.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">{td("noBreachedOpenTickets")}</TableCell></TableRow>}
            {s.breachedOpen.map((t) => (
              <TableRow key={t.number}>
                <TableCell><Link href={`/admin/tickets/${t.number}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link> {t.subject}</TableCell>
                <TableCell>{t.priority}</TableCell><TableCell>{t.team}</TableCell><TableCell>{t.agent ?? td("unassigned")}</TableCell><TableCell>{fmt.dateTime(t.dueAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </DashboardFrame>
  );
}
