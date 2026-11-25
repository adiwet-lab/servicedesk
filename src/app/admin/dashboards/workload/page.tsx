import Link from "next/link";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getWorkload } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { GroupedBars } from "@/components/dashboard/charts";
import { Panel } from "@/components/dashboard/widgets";
import { WorkloadTable } from "@/components/dashboard/workload-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("workload");

export default async function WorkloadDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const td = await getTranslations("dash");
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "workload", params);
  const w = await getWorkload(actor, filters);
  return (
    <DashboardFrame actor={actor} current="workload" title={td("workload")} description={td("currentOpenWorkPerAgentAnd")}
      params={params} options={options} filters={filters} hide={["agent", "status"]}>
      <Panel title={td("agentWorkload")}>
        <GroupedBars data={w.agents.slice(0, 25).map((a) => ({ name: a.name, assigned: a.assigned, openTasks: a.openTasks, completed: a.completed }))}
          series={[{ key: "assigned", label: td("chart.assignedTickets") }, { key: "openTasks", label: td("chart.openTasks") }, { key: "completed", label: td("chart.completed") }]} />
        <WorkloadTable rows={w.agents} />
      </Panel>
      <Panel title={td("teams")}>
        <Table className="text-sm" data-testid="team-table">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{td("team")}</TableHead><TableHead className="text-right">{td("open")}</TableHead><TableHead className="text-right">{td("unassigned")}</TableHead><TableHead className="text-right">{td("overdue")}</TableHead><TableHead className="text-right">{td("slaBreached")}</TableHead><TableHead className="text-right">{td("completed")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {w.teams.map((t) => (
              <TableRow key={t.teamId}>
                <TableCell>{t.href ? <Link href={t.href} className="font-medium hover:underline">{t.name}</Link> : t.name}</TableCell>
                <TableCell className="text-right tabular-nums">{t.open}</TableCell><TableCell className="text-right tabular-nums">{t.unassigned}</TableCell>
                <TableCell className="text-right tabular-nums">{t.overdue}</TableCell><TableCell className="text-right tabular-nums">{t.breached}</TableCell>
                <TableCell className="text-right tabular-nums">{t.completed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </DashboardFrame>
  );
}
