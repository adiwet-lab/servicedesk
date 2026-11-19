import Link from "next/link";
import { BellOff, Check } from "lucide-react";
import { prisma } from "@/server/db";
import { requireActor } from "@/server/auth/get-actor";
import { listNotifications } from "@/server/services/notifications";
import { markNotificationsReadAction } from "@/server/actions/tickets";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn, formatDateTime } from "@/lib/utils";
import { NOTIFICATION_TYPES } from "@/server/services/notifications";
import { InboxLiveRefresh } from "@/components/chat/inbox-live";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const actor = await requireActor();
  const unreadOnly = (await searchParams).filter === "unread";
  const items = await listNotifications(prisma, actor, { take: 100, unreadOnly });
  return (
    <div className="max-w-3xl">
      <InboxLiveRefresh />
      <PageHeader title="Notifications" description="In-app notifications about your tickets and assignments."
        actions={items.some((n) => !n.readAt) && (
          <form action={markNotificationsReadAction}><Button variant="outline" type="submit"><Check /> Mark all read</Button></form>
        )} />
      <div className="mb-3 flex w-fit rounded-md border p-0.5 text-sm">
        <Link href="/notifications" className={cn("rounded px-3 py-1", !unreadOnly && "bg-muted font-medium")}>All</Link>
        <Link href="/notifications?filter=unread" className={cn("rounded px-3 py-1", unreadOnly && "bg-muted font-medium")}>Unread</Link>
      </div>
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? <EmptyState icon={<BellOff />} title="You're all caught up" /> : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id} className={cn("flex items-start gap-3 px-5 py-3", !n.readAt && "bg-primary/5")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                  <div className="min-w-0 flex-1">
                    {n.link ? <Link href={n.link} className="font-medium hover:underline">{n.title}</Link> : <p className="font-medium">{n.title}</p>}
                    {n.body && <p className="truncate text-sm text-muted-foreground">{n.body}</p>}
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES] ?? n.type}</span>
                    <p className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
                  </div>
                  {!n.readAt && (
                    <form action={markNotificationsReadAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <Button variant="ghost" size="sm" type="submit">Mark read</Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
