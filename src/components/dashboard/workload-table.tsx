import Link from "next/link";
import type { AgentWorkloadRow } from "@/server/services/analytics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration } from "./widgets";

export function WorkloadTable({ rows }: { rows: AgentWorkloadRow[] }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No agents in scope.</p>;
  return (
    <Table className="mt-3 text-sm" data-testid="workload-table">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Agent</TableHead><TableHead className="text-right">Assigned</TableHead><TableHead className="text-right">In progress</TableHead>
          <TableHead className="text-right">Waiting</TableHead><TableHead className="text-right">Open tasks</TableHead><TableHead className="text-right">Overdue tasks</TableHead>
          <TableHead className="text-right">Completed</TableHead><TableHead className="text-right">Avg resolution</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.agentId}>
            <TableCell>{r.href ? <Link href={r.href} className="font-medium hover:underline">{r.name}</Link> : <span className="font-medium">{r.name}</span>}<span className="block text-xs text-muted-foreground">{r.teams}</span></TableCell>
            <TableCell className="text-right tabular-nums">{r.assigned}</TableCell>
            <TableCell className="text-right tabular-nums">{r.inProgress}</TableCell>
            <TableCell className="text-right tabular-nums">{r.waiting}</TableCell>
            <TableCell className="text-right tabular-nums">{r.openTasks}</TableCell>
            <TableCell className={`text-right tabular-nums ${r.overdueTasks ? "font-semibold text-destructive" : ""}`}>{r.overdueTasks}</TableCell>
            <TableCell className="text-right tabular-nums">{r.completed}</TableCell>
            <TableCell className="text-right tabular-nums">{formatDuration(r.avgResolutionMin)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
