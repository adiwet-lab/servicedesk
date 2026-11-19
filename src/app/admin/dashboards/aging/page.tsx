import Link from "next/link";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getAging } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { KpiCard } from "@/components/dashboard/kpi";
import { StackedColumns } from "@/components/dashboard/charts";
import { Panel } from "@/components/dashboard/widgets";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Ticket Aging" };

export default async function AgingDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "aging", params);
  const a = await getAging(actor, filters);
  return (
    <DashboardFrame actor={actor} current="aging" title="Ticket Aging" description="Age of the current open backlog (date range does not apply)."
      params={params} options={options} filters={filters}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Open tickets" value={a.totalOpen} />
        <KpiCard label="Average age" value={a.avgAgeDays == null ? "—" : `${a.avgAgeDays} days`} />
        <KpiCard label="Older than 7 days" value={a.buckets.filter((b) => b.key === "8-14" || b.key === "15+").reduce((x, b) => x + b.total, 0)} tone="danger" />
        <KpiCard label="Older than 14 days" value={a.buckets.find((b) => b.key === "15+")!.total} tone="danger" />
      </div>
      <Panel title="Open tickets by age and priority" description="Darker = more urgent priority">
        <StackedColumns data={a.buckets.map((b) => ({ label: b.label, ...Object.fromEntries(a.priorities.map((p) => [p, b.byPriority[p] ?? 0])) }))} keys={a.priorities} height={300} />
        <Table className="mt-3 text-sm" data-testid="aging-table">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Age</TableHead>{a.priorities.map((p) => <TableHead key={p} className="text-right">{p}</TableHead>)}<TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
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
      <Panel title="Oldest open tickets">
        <Table className="text-sm">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Ticket</TableHead><TableHead>Age</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Team</TableHead><TableHead>Agent</TableHead></TableRow></TableHeader>
          <TableBody>
            {a.oldest.map((t) => (
              <TableRow key={t.number}>
                <TableCell><Link href={`/admin/tickets/${t.number}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link> {t.subject}</TableCell>
                <TableCell className="tabular-nums">{t.ageDays}d</TableCell><TableCell>{t.priority}</TableCell><TableCell>{t.status}</TableCell><TableCell>{t.team}</TableCell><TableCell>{t.agent ?? "Unassigned"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </DashboardFrame>
  );
}
