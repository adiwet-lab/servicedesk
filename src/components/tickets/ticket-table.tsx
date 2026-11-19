import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Lock, TicketX } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { formatAging, formatDateTime } from "@/lib/utils";
import type { TicketListRow } from "@/server/services/tickets";
import { PriorityBadge, SlaBadge, StatusBadge } from "./badges";

type Params = Record<string, string | undefined>;

function href(base: string, params: Params, patch: Params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

function SortHead({ label, field, base, params }: { label: string; field: string; base: string; params: Params }) {
  const active = (params.sort ?? "createdAt") === field;
  const dir = params.dir ?? "desc";
  const next = active && dir === "desc" ? "asc" : "desc";
  return (
    <TableHead>
      <Link href={href(base, params, { sort: field, dir: next, page: undefined })} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </Link>
    </TableHead>
  );
}

export function TicketTable({
  rows, total, page, pages, base, params, detailBase = "/tickets",
}: {
  rows: TicketListRow[]; total: number; page: number; pages: number; base: string; params: Params; detailBase?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState icon={<TicketX />} title="No tickets found" description="Try adjusting the filters or search terms." />;
  }
  const now = new Date();
  return (
    <div>
      <Table data-testid="ticket-table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHead label="Ticket" field="number" base={base} params={params} />
            <SortHead label="Subject" field="subject" base={base} params={params} />
            <TableHead>Category</TableHead>
            <TableHead>Requester</TableHead>
            <TableHead>Dept / Branch</TableHead>
            <SortHead label="Priority" field="priority" base={base} params={params} />
            <SortHead label="Status" field="status" base={base} params={params} />
            <TableHead>Team / Agent</TableHead>
            <SortHead label="Created" field="createdAt" base={base} params={params} />
            <SortHead label="Updated" field="updatedAt" base={base} params={params} />
            <TableHead>Aging</TableHead>
            <SortHead label="SLA" field="resolutionDueAt" base={base} params={params} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => {
            const overdue = t.resolutionDueAt && !t.resolvedAt && t.resolutionDueAt < now && ["NEW", "OPEN", "WAITING"].includes(t.status.kind);
            return (
              <TableRow key={t.id} className={overdue ? "bg-destructive/5" : undefined}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  <Link href={`${detailBase}/${t.number}`} className="font-semibold text-primary hover:underline">{t.number}</Link>
                </TableCell>
                <TableCell className="max-w-72">
                  <Link href={`${detailBase}/${t.number}`} className="line-clamp-2 font-medium hover:underline">
                    {t.isConfidential && <Lock className="mr-1 inline size-3 text-amber-600" aria-label="Confidential" />}
                    {t.subject}
                  </Link>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  <div>{t.category.name}</div>
                  <div className="text-muted-foreground">{t.subcategory?.name}</div>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">{t.requester.displayName}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  <div>{t.department?.name ?? "—"}</div>
                  <div className="text-muted-foreground">{t.branch?.name}</div>
                </TableCell>
                <TableCell><PriorityBadge priority={t.priority} /></TableCell>
                <TableCell><StatusBadge status={t.status} /></TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  <div>{t.ownerTeam?.name ?? <span className="text-muted-foreground">Unrouted</span>}</div>
                  <div className="text-muted-foreground">{t.assignedAgent?.displayName ?? "Unassigned"}</div>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(t.createdAt)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(t.updatedAt)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{formatAging(t.createdAt, t.closedAt ?? t.resolvedAt ?? now)}</TableCell>
                <TableCell><SlaBadge ticket={t} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between border-t px-3 py-3 text-sm text-muted-foreground">
        <span>{total} ticket{total === 1 ? "" : "s"} · page {page} of {pages}</span>
        <div className="flex gap-1">
          {page > 1 ? (
            <Link className="rounded-md border p-1.5 hover:bg-accent" href={href(base, params, { page: String(page - 1) })} aria-label="Previous page"><ChevronLeft className="size-4" /></Link>
          ) : <span className="rounded-md border p-1.5 opacity-40"><ChevronLeft className="size-4" /></span>}
          {page < pages ? (
            <Link className="rounded-md border p-1.5 hover:bg-accent" href={href(base, params, { page: String(page + 1) })} aria-label="Next page"><ChevronRight className="size-4" /></Link>
          ) : <span className="rounded-md border p-1.5 opacity-40"><ChevronRight className="size-4" /></span>}
        </div>
      </div>
    </div>
  );
}
