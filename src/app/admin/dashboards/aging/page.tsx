import Link from "next/link";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getAging } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { KpiCard } from "@/components/dashboard/kpi";
import { StackedColumns } from "@/components/dashboard/charts";
import { Panel } from "@/components/dashboard/widgets";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("ticketAging");

export default async function AgingDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const td = await getTranslations("dash");
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "aging", params);
  const a = await getAging(actor, filters);
  return (
    <DashboardFrame actor={actor} current="aging" title={td("ticketAging")} description={td("ageOfTheCurrentOpenBacklog")}
      params={params} options={options} filters={filters}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label={td("openTickets")} value={a.totalOpen} />
        <KpiCard label={td("averageAge")} value={a.avgAgeDays == null ? "—" : `${a.avgAgeDays} days`} />
        <KpiCard label={td("olderThan7Days")} value={a.buckets.filter((b) => b.key === "8-14" || b.key === "15+").reduce((x, b) => x + b.total, 0)} tone="danger" />
        <KpiCard label={td("olderThan14Days")} value={a.buckets.find((b) => b.key === "15+")!.total} tone="danger" />
      </div>
      <Panel title={td("openTicketsByAgeAndPriority")} description={td("darkerMoreUrgentPriority")}>
        <StackedColumns data={a.buckets.map((b) => ({ label: b.label, ...Object.fromEntries(a.priorities.map((p) => [p, b.byPriority[p] ?? 0])) }))} keys={a.priorities} height={300} />
        <Table className="mt-3 text-sm" data-testid="aging-table">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{td("age")}</TableHead>{a.priorities.map((p) => <TableHead key={p} className="text-right">{p}</TableHead>)}<TableHead className="text-right">{td("total")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {a.buckets.map((b) => (
              <TableRow key={b.key}>
                <TableCell>{b.href ? <Link href={b.href} className="hover:underline">{b.label}</Link> : b.label}</TableCell>
                {a.priorities.map((p) => <TableCell key={p} className="text-right tabular-nums">{b.byPriority[p] ?? 0}</TableCell>)}
                <TableCell className="text-right font-medium tabular-nums">{b.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      <Panel title={td("oldestOpenTickets")}>
        <Table className="text-sm">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{td("ticket")}</TableHead><TableHead>{td("age")}</TableHead><TableHead>{td("priority")}</TableHead><TableHead>{td("status")}</TableHead><TableHead>{td("team")}</TableHead><TableHead>{td("agent")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {a.oldest.map((t) => (
              <TableRow key={t.number}>
                <TableCell><Link href={`/admin/tickets/${t.number}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link> {t.subject}</TableCell>
                <TableCell className="tabular-nums">{td("daysShort", { n: t.ageDays })}</TableCell><TableCell>{t.priority}</TableCell><TableCell>{t.status}</TableCell><TableCell>{t.team}</TableCell><TableCell>{t.agent ?? td("unassigned")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </DashboardFrame>
  );
}
