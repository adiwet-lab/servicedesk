import Link from "next/link";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Accessible table view behind a chart (also the drill-down entry point). */
export function BreakdownTable({ rows, label, total, swatch = false }: {
  rows: { id: string | null; name: string; count: number; color?: string; href?: string }[]; label: string; total?: number; swatch?: boolean;
}) {
  const sum = total ?? rows.reduce((a, r) => a + r.count, 0);
  if (!rows.length) return null;
  return (
    <Table className="text-xs">
      <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{label}</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Share</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id ?? r.name}>
            <TableCell className="py-1.5">
              <span className="inline-flex items-center gap-2">
                {swatch && <span className="size-2 rounded-full" style={{ backgroundColor: r.color ?? "var(--series-1)" }} aria-hidden />}
                {r.href ? <Link href={r.href} className="hover:underline">{r.name}</Link> : r.name}
              </span>
            </TableCell>
            <TableCell className="py-1.5 text-right tabular-nums">{r.count}</TableCell>
            <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">{sum ? `${Math.round((r.count / sum) * 100)}%` : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Compliance stat with meter; state is carried by icon + label, never color alone. */
export function ComplianceMeter({ label, value, target = 95, hint }: { label: string; value: number | null; target?: number; hint?: string }) {
  const state = value == null ? "none" : value >= target ? "good" : value >= target - 10 ? "warning" : "critical";
  const meta = {
    good: { color: "var(--status-good)", Icon: CheckCircle2, text: "Meets target" },
    warning: { color: "var(--status-warning)", Icon: AlertTriangle, text: "Below target" },
    critical: { color: "var(--status-critical)", Icon: XCircle, text: "Well below target" },
    none: { color: "var(--viz-axis)", Icon: MinusCircle, text: "No SLA data" },
  }[state];
  return (
    <div className="rounded-xl border bg-card p-4" data-testid={`meter-${label}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value == null ? "—" : `${value}%`}</p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${value ?? 0}%`, backgroundColor: meta.color }} />
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <meta.Icon className="size-3.5" style={{ color: meta.color }} aria-hidden /> {meta.text} · target {target}%{hint ? ` · ${hint}` : ""}
      </p>
    </div>
  );
}

export function Panel({ title, description, children, className, action }: {
  title: string; description?: string; children: React.ReactNode; className?: string; action?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-5 shadow-sm", className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function formatDuration(mins: number | null): string {
  if (mins == null) return "—";
  const m = Math.round(mins);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), r = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${r}m`;
  return `${r}m`;
}
