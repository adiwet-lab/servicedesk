import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Lock, MessageSquare, TicketX } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { useLocale, useTranslations } from "next-intl";
import { makeFormat } from "@/lib/format";
import { ln } from "@/lib/localized";
import type { Locale } from "@/i18n/config";
import type { TicketListRow } from "@/server/services/tickets";
import { PriorityBadge, SlaBadge, StatusBadge } from "./badges";
import { Badge } from "@/components/ui/badge";

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
  rows, total, page, pages, base, params, detailBase = "/tickets", unread = {},
}: {
  rows: TicketListRow[]; total: number; page: number; pages: number; base: string; params: Params; detailBase?: string;
  /** Unread chat messages per ticket id. */
  unread?: Record<string, number>;
}) {
  const tt = useTranslations("ticketTable");
  const locale = useLocale() as Locale;
  const f = makeFormat(locale);
  if (rows.length === 0) {
    return <EmptyState icon={<TicketX />} title={tt("emptyTitle")} description={tt("emptyDescription")} />;
  }
  const now = new Date();
  return (
    <div>
      <Table data-testid="ticket-table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHead label={tt("ticket")} field="number" base={base} params={params} />
            <SortHead label={tt("subject")} field="subject" base={base} params={params} />
            <TableHead>{tt("category")}</TableHead>
            <TableHead>{tt("requester")}</TableHead>
            <TableHead>{tt("deptBranch")}</TableHead>
            <SortHead label={tt("priority")} field="priority" base={base} params={params} />
            <SortHead label={tt("status")} field="status" base={base} params={params} />
            <TableHead>{tt("teamAgent")}</TableHead>
            <SortHead label={tt("created")} field="createdAt" base={base} params={params} />
            <SortHead label={tt("updated")} field="updatedAt" base={base} params={params} />
            <TableHead>{tt("aging")}</TableHead>
            <SortHead label={tt("sla")} field="resolutionDueAt" base={base} params={params} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => {
            const overdue = t.resolutionDueAt && !t.resolvedAt && t.resolutionDueAt < now && ["NEW", "OPEN", "WAITING"].includes(t.status.kind);
            return (
              <TableRow key={t.id} className={overdue ? "bg-destructive/5" : undefined}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  <Link href={`${detailBase}/${t.number}`} className="font-semibold text-primary hover:underline">{t.number}</Link>
                  {(unread[t.id] ?? 0) > 0 && (
                    <Link href={`${detailBase}/${t.number}?tab=chat`} className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white" title={tt("unreadMessages", { count: unread[t.id] ?? 0 })} data-testid="row-unread">
                      <MessageSquare className="size-2.5" />{unread[t.id]}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="max-w-72">
                  <Link href={`${detailBase}/${t.number}`} className="line-clamp-2 font-medium hover:underline">
                    {t.isConfidential && <Lock className="mr-1 inline size-3 text-amber-600" aria-label={tt("confidential")} />}
                    {t.subject}
                  </Link>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  <div>{ln(t.category, locale)}</div>
                  <div className="text-muted-foreground">{t.subcategory ? ln(t.subcategory, locale) : null}</div>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">{t.requester.displayName}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  <div>{t.department ? ln(t.department, locale) : "—"}</div>
                  <div className="text-muted-foreground">{t.branch ? ln(t.branch, locale) : null}</div>
                </TableCell>
                <TableCell><PriorityBadge priority={t.priority} /></TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={t.status} />
                    {t.approvalStatus === "PENDING" && <Badge variant="warning" data-testid="approval-badge">{tt("awaitingApproval")}</Badge>}
                    {t.approvalStatus === "REJECTED" && <Badge variant="destructive">{tt("notApproved")}</Badge>}
                    {t.isMajorIncident && t.majorIncidentStatus !== "RESOLVED" && <Badge variant="destructive">{tt("major")}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  <div>{t.ownerTeam ? ln(t.ownerTeam, locale) : <span className="text-muted-foreground">{tt("unrouted")}</span>}</div>
                  <div className="text-muted-foreground">{t.assignedAgent?.displayName ?? tt("unassigned")}</div>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{f.dateTime(t.createdAt)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{f.dateTime(t.updatedAt)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{f.aging(t.createdAt, t.closedAt ?? t.resolvedAt ?? now)}</TableCell>
                <TableCell><SlaBadge ticket={t} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between border-t px-3 py-3 text-sm text-muted-foreground">
        <span>{tt("pager", { total, page, pages })}</span>
        <div className="flex gap-1">
          {page > 1 ? (
            <Link className="rounded-md border p-1.5 hover:bg-accent" href={href(base, params, { page: String(page - 1) })} aria-label={tt("previous")}><ChevronLeft className="size-4" /></Link>
          ) : <span className="rounded-md border p-1.5 opacity-40"><ChevronLeft className="size-4" /></span>}
          {page < pages ? (
            <Link className="rounded-md border p-1.5 hover:bg-accent" href={href(base, params, { page: String(page + 1) })} aria-label={tt("next")}><ChevronRight className="size-4" /></Link>
          ) : <span className="rounded-md border p-1.5 opacity-40"><ChevronRight className="size-4" /></span>}
        </div>
      </div>
    </div>
  );
}
