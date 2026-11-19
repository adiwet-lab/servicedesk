import Link from "next/link";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getWorkload } from "@/server/services/analytics";
import { DashboardFrame, loadDashboard } from "@/components/dashboard/frame";
import { GroupedBars } from "@/components/dashboard/charts";
import { Panel } from "@/components/dashboard/widgets";
import { WorkloadTable } from "@/components/dashboard/workload-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Workload" };

export default async function WorkloadDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const { filters, options } = await loadDashboard(actor, "workload", params);
  const w = await getWorkload(actor, filters);
  return (
    <DashboardFrame actor={actor} current="workload" title="Workload" description="Current open work per agent and team; completed = resolved in the period."
      params={params} options={options} filters={filters} hide={["agent", "status"]}>
      <Panel title="Agent workload">
        <GroupedBars data={w.agents.slice(0, 25).map((a) => ({ name: a.name, assigned: a.assigned, openTasks: a.openTasks, completed: a.completed }))}
          series={[{ key: "assigned", label: "Assigned tickets" }, { key: "openTasks", label: "Open tasks" }, { key: "completed", label: "Completed in period" }]} />
        <WorkloadTable rows={w.agents} />
      </Panel>
      <Panel title="Teams">
        <Table className="text-sm" data-testid="team-table">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Team</TableHead><TableHead className="text-right">Open</TableHead><TableHead className="text-right">Unassigned</TableHead><TableHead className="text-right">Overdue</TableHead><TableHead className="text-right">SLA breached</TableHead><TableHead className="text-right">Completed</TableHead></TableRow></TableHeader>
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
