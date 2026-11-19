import Link from "next/link";
import { cn } from "@/lib/utils";

export function KpiCard({ label, value, color, href, hint, tone }: {
  label: string; value: number | string; color?: string; href?: string; hint?: string; tone?: "danger" | "success" | "default";
}) {
  const body = (
    <div className={cn("group relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-shadow", href && "hover:shadow-md")}>
      {color && <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} />}
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "danger" && Number(value) > 0 && "text-destructive", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} data-testid={`kpi-${label}`}>{body}</Link> : <div data-testid={`kpi-${label}`}>{body}</div>;
}
