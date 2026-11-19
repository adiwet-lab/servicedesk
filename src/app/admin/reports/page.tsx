import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { dateWindow, getFilterOptions, isOrgWide, parseAnalyticsFilters } from "@/server/services/analytics";
import { REPORT_TYPES, runReport, type ReportType } from "@/server/services/reports";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reports" };
const PREVIEW = 50;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  if (!can(actor, P.REPORT_EXPORT)) notFound();
  const params = await searchParams;
  const type = (params.type && params.type in REPORT_TYPES ? params.type : "tickets") as ReportType;
  const filters = parseAnalyticsFilters(params);
  const [options, preview] = await Promise.all([getFilterOptions(actor), runReport(actor, type, filters, PREVIEW)]);
  const exportQuery = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== "type") as [string, string][]).toString();
  const keep = (t: string) => `/admin/reports?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v) as [string, string][]), type: t })}`;
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" description={<>Run and export reports — {isOrgWide(actor) ? "organisation-wide" : "limited to your teams and tickets"} · {dateWindow(filters).label}</>}
        actions={<Button asChild data-testid="export-csv"><a href={`/api/reports/${type}${exportQuery ? `?${exportQuery}` : ""}`}><Download /> Export CSV</a></Button>} />
      <nav className="flex flex-wrap gap-2" aria-label="Report type">
        {(Object.entries(REPORT_TYPES) as [ReportType, (typeof REPORT_TYPES)[ReportType]][]).map(([k, v]) => (
          <Link key={k} href={keep(k)} className={cn("rounded-lg border px-3 py-2 text-sm", k === type ? "border-primary bg-primary/10 font-medium" : "bg-card hover:bg-accent")}
            aria-current={k === type ? "page" : undefined} data-testid={`report-${k}`}>{v.label}</Link>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">{REPORT_TYPES[type].description}</p>
      <FilterBar base="/admin/reports" params={params} options={options} hidden={{ type }} />
      <Alert>Preview shows the first {PREVIEW} rows. Exports contain up to 50,000 rows, are limited to your data scope, never include chat messages or internal notes, and are recorded in the audit log.</Alert>
      <Card className="overflow-hidden">
        <Table className="text-xs" data-testid="report-preview">
          <TableHeader><TableRow className="hover:bg-transparent">{preview.headers.map((h) => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {preview.rows.length === 0 && <TableRow><TableCell colSpan={preview.headers.length} className="py-8 text-center text-muted-foreground">No rows for the selected filters.</TableCell></TableRow>}
            {preview.rows.map((r, i) => (
              <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className="whitespace-nowrap py-1.5">{c ?? "—"}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
        {preview.truncated && <p className="border-t px-3 py-2 text-xs text-muted-foreground">More rows available — export to CSV for the full report.</p>}
      </Card>
    </div>
  );
}
