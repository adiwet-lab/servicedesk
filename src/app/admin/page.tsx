import { requireAdminPortal } from "@/server/auth/get-actor";
import { canAny } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getDashboardStats } from "@/server/services/dashboard";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi";
import { DonutChart, HBarChart, TrendChart } from "@/components/dashboard/charts";
import { formatAging } from "@/lib/utils";

export const metadata = { title: "Admin Dashboard" };

const dur = (m: number | null) => (m == null ? "—" : formatAging(new Date(0), new Date(m * 60000)));

export default async function AdminDashboard() {
  const actor = await requireAdminPortal();
  if (!canAny(actor, [P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL])) {
    return <PageHeader title="Admin Portal" description="Use the menu to manage configuration." />;
  }
  const s = await getDashboardStats(actor);
  const k = s.kpis;
  const t = (view: string) => `/admin/tickets?view=${view}`;
  return (
    <div className="space-y-6">
      <PageHeader title={s.management ? "Management Dashboard" : "Support Dashboard"}
        description={s.management ? "Organisation-wide service desk performance (last 30 days trend)." : "Tickets within your teams and assignments."} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Total Tickets" value={k.total} href={t("all")} color="#3b82f6" />
        <KpiCard label="New Tickets" value={k.new} color="#6366f1" />
        <KpiCard label="Open Tickets" value={k.open} color="#0ea5e9" />
        <KpiCard label="In Progress" value={k.inProgress} color="#f59e0b" />
        <KpiCard label="Waiting" value={k.waiting} color="#a855f7" />
        <KpiCard label="Unassigned" value={k.unassigned} href={t("unassigned")} tone="danger" color="#f97316" />
        <KpiCard label="Resolved" value={k.resolved} color="#10b981" />
        <KpiCard label="Closed" value={k.closed} color="#334155" />
        <KpiCard label="Overdue" value={k.overdue} href={t("overdue")} tone="danger" color="#ef4444" />
        <KpiCard label="SLA Breached" value={k.slaBreached} href={t("breached")} tone="danger" color="#dc2626" />
        <KpiCard label="SLA Compliance" value={k.slaCompliance == null ? "—" : `${k.slaCompliance}%`} tone="success" color="#16a34a" hint="Resolved within due date" />
        <KpiCard label="Avg Response" value={dur(k.avgResponseMin)} color="#64748b" hint={`Avg resolution ${dur(k.avgResolutionMin)}`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Ticket trend</CardTitle></CardHeader><CardContent><TrendChart data={s.trend} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Tickets by status</CardTitle></CardHeader><CardContent><DonutChart data={s.statusCounts} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Tickets by category</CardTitle></CardHeader><CardContent><HBarChart data={s.categoryCounts} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Tickets by support team</CardTitle></CardHeader><CardContent><HBarChart data={s.teamCounts} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Open tickets by priority</CardTitle></CardHeader><CardContent><HBarChart data={s.priorityCounts} height={200} /></CardContent></Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Coming in Phase 5</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Ticket aging buckets, agent workload, SLA performance trends, branch/subcategory breakdowns and dashboard filters (date range, company, department, branch, team, agent).</CardContent>
        </Card>
      </div>
    </div>
  );
}
