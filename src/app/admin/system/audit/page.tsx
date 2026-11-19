import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { listAuditLogs } from "@/server/services/admin/system";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Audit Logs" };

function Json({ v }: { v: unknown }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const s = JSON.stringify(v);
  return <code className="block max-w-xs truncate text-[11px]" title={JSON.stringify(v, null, 2)}>{s}</code>;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  if (!can(actor, P.AUDIT_READ)) notFound();
  const sp = await searchParams;
  const r = await listAuditLogs(actor, { ...sp, page: Number(sp.page ?? 1) });
  const exportQs = (format: string) => `/api/audit/export?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "page")) as Record<string, string>, format })}`;
  const qs = (page: number) => `?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(page) })}`;
  return (
    <div>
      <PageHeader title="Audit Logs" description="Append-only record of security-relevant and data changes. Protected by a database trigger — entries cannot be modified or deleted. Retention: export for archival (default range: last 30 days, max 366)."
        actions={<div className="flex gap-2">
          <Button asChild variant="outline"><a href={exportQs("csv")} data-testid="audit-export-csv">Export CSV</a></Button>
          <Button asChild variant="outline"><a href={exportQs("ndjson")} data-testid="audit-export-ndjson">Export NDJSON</a></Button>
        </div>} />
      <Card className="overflow-hidden">
        <form method="get" className="flex flex-wrap items-end gap-2 border-b p-3">
          <Input name="q" defaultValue={sp.q} placeholder="Ticket no., entity ID or user name" className="min-w-56 flex-1" aria-label="Search" />
          <NativeSelect name="action" defaultValue={sp.action ?? ""} className="w-56" aria-label="Action"><option value="">All actions</option>{r.actions.map((a) => <option key={a}>{a}</option>)}</NativeSelect>
          <NativeSelect name="entity" defaultValue={sp.entity ?? ""} className="w-44" aria-label="Entity"><option value="">All entities</option>{r.entities.map((a) => <option key={a}>{a}</option>)}</NativeSelect>
          <Input type="date" name="from" defaultValue={sp.from} className="w-40" aria-label="From" />
          <Input type="date" name="to" defaultValue={sp.to} className="w-40" aria-label="To" />
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Timestamp</TableHead><TableHead>Action</TableHead><TableHead>User</TableHead><TableHead>Entity</TableHead><TableHead>Ticket</TableHead><TableHead>Previous</TableHead><TableHead>New</TableHead><TableHead>IP</TableHead></TableRow></TableHeader>
          <TableBody>
            {r.rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap text-xs">{formatDateTime(a.createdAt)}</TableCell>
                <TableCell><Badge variant="secondary" className="font-mono text-[10px]">{a.action}</Badge></TableCell>
                <TableCell className="text-xs">{a.actor?.displayName ?? "System"}</TableCell>
                <TableCell className="text-xs">{a.entityType}<span className="block font-mono text-[10px] text-muted-foreground">{a.entityId}</span></TableCell>
                <TableCell className="text-xs">{a.ticket ? <Link href={`/admin/tickets/${a.ticket.number}`} className="text-primary hover:underline">{a.ticket.number}</Link> : "—"}</TableCell>
                <TableCell><Json v={a.oldValue} /></TableCell>
                <TableCell><Json v={a.newValue} /></TableCell>
                <TableCell className="font-mono text-[11px]">{a.ipAddress ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-3 py-3 text-sm text-muted-foreground">
          <span>{r.total} entries · page {r.page} of {r.pages}</span>
          <div className="flex gap-1">
            {r.page > 1 && <Link className="rounded-md border p-1.5 hover:bg-accent" href={qs(r.page - 1)}><ChevronLeft className="size-4" /></Link>}
            {r.page < r.pages && <Link className="rounded-md border p-1.5 hover:bg-accent" href={qs(r.page + 1)}><ChevronRight className="size-4" /></Link>}
          </div>
        </div>
      </Card>
    </div>
  );
}
