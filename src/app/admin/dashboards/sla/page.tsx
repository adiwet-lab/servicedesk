import Link from "next/link";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getSlaPerformance } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { KpiCard } from "@/components/dashboard/kpi";
import { StackedColumns, TrendLines } from "@/components/dashboard/charts";
import { ComplianceMeter, Panel } from "@/components/dashboard/widgets";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "SLA Dashboard" };

export default async function SlaDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "sla", params);
  const s = await getSlaPerformance(actor, filters);
  const ct = (rows: typeof s.byPriority, label: string) => (
    <Table className="text-sm">
      <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{label}</TableHead><TableHead className="text-right">Resolved</TableHead><TableHead className="text-right">Breached</TableHead><TableHead className="text-right">Compliance</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No tickets with an SLA were resolved in this period.</TableCell></TableRow>}
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
    <DashboardFrame actor={actor} current="sla" title="SLA Dashboard" description="Compliance of resolved tickets in the period and SLA state of the open backlog."
      params={params} options={options} filters={filters}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ComplianceMeter label="Resolution compliance" value={s.resolutionCompliance} hint={`${s.resolvedWithSla} resolved with SLA`} />
        <ComplianceMeter label="Response compliance" value={s.responseCompliance} />
        <KpiCard label="Open: breached" value={s.openStates.BREACHED} tone="danger" />
        <KpiCard label="Open: warning / paused" value={`${s.openStates.WARNING} / ${s.openStates.PAUSED}`} hint={`${s.openStates.ON_TRACK} on track`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Compliance trend" description={`Per ${s.window.granularity}`}>
          <TrendLines data={s.trend} percent series={[{ key: "resolutionCompliance", label: "Resolution" }, { key: "responseCompliance", label: "Response" }]} />
        </Panel>
        <Panel title="Resolved within / outside SLA" description="Resolution clock">
          <StackedColumns data={s.trend.map((t) => ({ label: t.period, "Within SLA": t.met, Breached: t.breached }))} keys={["Breached", "Within SLA"]} />
        </Panel>
        <Panel title="Compliance by priority">{ct(s.byPriority, "Priority")}</Panel>
        <Panel title="Compliance by team" description="Lowest first">{ct(s.byTeam, "Team")}</Panel>
      </div>
      <Panel title="Breached open tickets" description="Oldest due first">
        <Table className="text-sm" data-testid="breach-list">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Ticket</TableHead><TableHead>Priority</TableHead><TableHead>Team</TableHead><TableHead>Agent</TableHead><TableHead>Was due</TableHead></TableRow></TableHeader>
          <TableBody>
            {s.breachedOpen.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No breached open tickets.</TableCell></TableRow>}
            {s.breachedOpen.map((t) => (
              <TableRow key={t.number}>
                <TableCell><Link href={`/admin/tickets/${t.number}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link> {t.subject}</TableCell>
                <TableCell>{t.priority}</TableCell><TableCell>{t.team}</TableCell><TableCell>{t.agent ?? "Unassigned"}</TableCell><TableCell>{formatDateTime(t.dueAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </DashboardFrame>
  );
}
