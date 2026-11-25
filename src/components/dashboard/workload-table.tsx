import Link from "next/link";
import type { AgentWorkloadRow } from "@/server/services/analytics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocale, useTranslations } from "next-intl";
import { makeFormat } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export function WorkloadTable({ rows }: { rows: AgentWorkloadRow[] }) {
  const td = useTranslations("dash");
  const f = makeFormat(useLocale() as Locale);
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{td("noAgentsInScope")}</p>;
  return (
    <Table className="mt-3 text-sm" data-testid="workload-table">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{td("agent")}</TableHead><TableHead className="text-right">{td("assigned")}</TableHead><TableHead className="text-right">{td("inProgress")}</TableHead>
          <TableHead className="text-right">{td("waiting")}</TableHead><TableHead className="text-right">{td("openTasks")}</TableHead><TableHead className="text-right">{td("overdueTasks")}</TableHead>
          <TableHead className="text-right">{td("completed")}</TableHead><TableHead className="text-right">{td("avgResolution")}</TableHead>
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
            <TableCell className="text-right tabular-nums">{r.avgResolutionMin == null ? "—" : f.duration(r.avgResolutionMin)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
