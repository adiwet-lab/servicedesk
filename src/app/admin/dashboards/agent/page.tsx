import Link from "next/link";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getMyWork } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { KpiCard } from "@/components/dashboard/kpi";
import { BarList } from "@/components/dashboard/charts";
import { ComplianceMeter, Panel } from "@/components/dashboard/widgets";
import { ColorBadge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { getFormat, currentLocale } from "@/i18n/server";
import { ln } from "@/lib/localized";

export const generateMetadata = pageTitle("myWork");

export default async function AgentDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [td, fmt, f0] = await Promise.all([getTranslations("dash"), getFormat(), currentLocale()]);
  const dur = (m: number | null) => (m == null ? "—" : fmt.duration(m));
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "agent", params);
  const m = await getMyWork(actor, filters);
  const now = new Date();
  return (
    <DashboardFrame actor={actor} current="agent" title={td("myWorkTitle", { name: actor.displayName })} description={td("yourTicketsTasksAndSlaPeriod")}
      params={params} options={options} filters={filters} hide={["agent", "company", "department"]}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8" data-testid="my-kpis">
        <KpiCard label={td("assignedToMe")} value={m.assigned} href="/admin/tickets?view=assigned" />
        <KpiCard label={td("inProgress")} value={m.inProgress} />
        <KpiCard label={td("waiting")} value={m.waiting} />
        <KpiCard label={td("overdue")} value={m.overdue} tone="danger" />
        <KpiCard label={td("slaBreached")} value={m.breached} tone="danger" />
        <KpiCard label={td("myOpenTasks")} value={m.openTasks} href="/admin/tasks?view=my" />
        <KpiCard label={td("overdueTasks")} value={m.overdueTasks} tone="danger" href="/admin/tasks?view=overdue" />
        <KpiCard label={td("resolvedInPeriod")} value={m.resolved} hint={td("avgValue", { v: dur(m.avgResolutionMin) })} />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <ComplianceMeter label={td("myResolutionSlaCompliance")} value={m.compliance} />
        <Panel title={td("ageOfMyOpenTickets")} className="xl:col-span-2"><BarList data={m.aging.map((a) => ({ name: a.label, count: a.count }))} valueLabel={td("tickets")} /></Panel>
      </div>
      <Panel title={td("nextDue")} description={td("myOpenTicketsOrderedByResolution")}>
        <Table className="text-sm">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{td("ticket")}</TableHead><TableHead>{td("priority")}</TableHead><TableHead>{td("status")}</TableHead><TableHead>{td("resolutionDue")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {m.nextDue.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">{td("nothingAssignedToYou")}</TableCell></TableRow>}
            {m.nextDue.map((t) => (
              <TableRow key={t.number}>
                <TableCell><Link href={`/admin/tickets/${t.number}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link> {t.subject}</TableCell>
                <TableCell><ColorBadge color={t.priority.color}>{t.priority.code}</ColorBadge></TableCell>
                <TableCell><ColorBadge color={t.status.color}>{ln(t.status, f0)}</ColorBadge></TableCell>
                <TableCell className={!t.slaPausedAt && t.resolutionDueAt && t.resolutionDueAt < now ? "font-semibold text-destructive" : ""}>
                  {t.slaPausedAt ? td("paused") : fmt.dateTime(t.resolutionDueAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </DashboardFrame>
  );
}
