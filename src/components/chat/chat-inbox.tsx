import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock, MessagesSquare, Search } from "lucide-react";
import type { Actor } from "@/server/authz/actor";
import { chatInbox } from "@/server/services/messages";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ColorBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn, formatDateTime } from "@/lib/utils";
import { InboxLiveRefresh } from "./inbox-live";

/** Conversation list (Support Chat for staff, Messages for requesters). */
export async function ChatInbox({ actor, base, ticketBase, title, description, params, mineOnly = false }: {
  actor: Actor; base: string; ticketBase: string; title: string; description: string;
  params: Record<string, string | undefined>; mineOnly?: boolean;
}) {
  const unreadOnly = params.unread === "1";
  const res = await chatInbox(actor, { q: params.q, unreadOnly, page: Number(params.page ?? 1), mineOnly });
  const qs = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) sp.set(k, v);
    return `${base}?${sp}`;
  };
  return (
    <div className="max-w-5xl">
      <InboxLiveRefresh />
      <PageHeader title={title} description={description} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <form method="get" action={base} className="flex flex-1 gap-2" role="search">
            {unreadOnly && <input type="hidden" name="unread" value="1" />}
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={params.q} placeholder="Search messages, ticket number or subject…" className="pl-9" aria-label="Search conversations" data-testid="inbox-search" />
            </div>
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          <div className="flex rounded-md border p-0.5 text-sm">
            <Link href={qs({ unread: undefined, page: undefined })} className={cn("rounded px-3 py-1", !unreadOnly && "bg-muted font-medium")}>All</Link>
            <Link href={qs({ unread: "1", page: undefined })} className={cn("rounded px-3 py-1", unreadOnly && "bg-muted font-medium")}>Unread {res.totalUnread > 0 && `(${res.totalUnread})`}</Link>
          </div>
        </div>
        {res.rows.length === 0 ? (
          <EmptyState icon={<MessagesSquare />} title={params.q ? "No conversations match your search" : unreadOnly ? "No unread messages" : "No conversations yet"} />
        ) : (
          <ul className="divide-y" data-testid="inbox-list">
            {res.rows.map((r) => (
              <li key={r.ticketId}>
                <Link href={`${ticketBase}/${r.number}?tab=chat`} className={cn("flex items-start gap-4 px-4 py-3 hover:bg-muted/40", r.unread > 0 && "bg-primary/5")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-primary">{r.number}</span>
                      <ColorBadge color={r.statusColor}>{r.statusName}</ColorBadge>
                      <span className={cn("truncate text-sm", r.unread > 0 ? "font-semibold" : "font-medium")}>{r.subject}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {r.lastType === "INTERNAL" && <Lock className="mr-1 inline size-3 text-amber-600" />}
                      <span className="font-medium text-foreground/80">{r.lastSender}:</span> {r.preview}
                    </p>
                    <p className="text-xs text-muted-foreground">Requester: {r.requester}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.lastAt)}</span>
                    {r.unread > 0 && <span className="rounded-full bg-destructive px-2 text-xs font-semibold text-white" data-testid="inbox-unread">{r.unread}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between border-t px-3 py-3 text-sm text-muted-foreground">
          <span>{res.total} conversation{res.total === 1 ? "" : "s"} · page {res.page} of {res.pages}</span>
          <div className="flex gap-1">
            {res.page > 1 && <Link className="rounded-md border p-1.5 hover:bg-accent" href={qs({ page: String(res.page - 1) })} aria-label="Previous page"><ChevronLeft className="size-4" /></Link>}
            {res.page < res.pages && <Link className="rounded-md border p-1.5 hover:bg-accent" href={qs({ page: String(res.page + 1) })} aria-label="Next page"><ChevronRight className="size-4" /></Link>}
          </div>
        </div>
      </Card>
    </div>
  );
}
