import Link from "next/link";
import { BellOff, Check } from "lucide-react";
import { prisma } from "@/server/db";
import { requireActor } from "@/server/auth/get-actor";
import { listNotifications } from "@/server/services/notifications";
import { markNotificationsReadAction } from "@/server/actions/tickets";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { NOTIFICATION_TYPES } from "@/server/services/notifications";
import { InboxLiveRefresh } from "@/components/chat/inbox-live";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/i18n/server";
import { renderNotification } from "@/i18n/notifications";

export const generateMetadata = pageTitle("notifications");

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const actor = await requireActor();
  const unreadOnly = (await searchParams).filter === "unread";
  const items = await listNotifications(prisma, actor, { take: 100, unreadOnly });
  const [t, tn, tt, tp, f] = await Promise.all([getTranslations("notificationsPage"), getTranslations("notify"), getTranslations("notificationType"), getTranslations("pageTitle"), getFormat()]);
  return (
    <div className="max-w-3xl">
      <InboxLiveRefresh />
      <PageHeader title={tp("notifications")} description={t("description")}
        actions={items.some((n) => !n.readAt) && (
          <form action={markNotificationsReadAction}><Button variant="outline" type="submit"><Check /> {t("markAllRead")}</Button></form>
        )} />
      <div className="mb-3 flex w-fit rounded-md border p-0.5 text-sm">
        <Link href="/notifications" className={cn("rounded px-3 py-1", !unreadOnly && "bg-muted font-medium")}>{t("all")}</Link>
        <Link href="/notifications?filter=unread" className={cn("rounded px-3 py-1", unreadOnly && "bg-muted font-medium")}>{t("unread")}</Link>
      </div>
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? <EmptyState icon={<BellOff />} title={t("caughtUp")} /> : (
            <ul className="divide-y">
              {items.map((n) => ({ n, r: renderNotification(n, tn as never) })).map(({ n, r }) => (
                <li key={n.id} className={cn("flex items-start gap-3 px-5 py-3", !n.readAt && "bg-primary/5")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                  <div className="min-w-0 flex-1">
                    {n.link ? <Link href={n.link} className="font-medium hover:underline">{r.title}</Link> : <p className="font-medium">{r.title}</p>}
                    {r.body && <p className="truncate text-sm text-muted-foreground">{r.body}</p>}
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{n.type in NOTIFICATION_TYPES ? tt(n.type as never) : n.type}</span>
                    <p className="text-xs text-muted-foreground">{f.dateTime(n.createdAt)}</p>
                  </div>
                  {!n.readAt && (
                    <form action={markNotificationsReadAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <Button variant="ghost" size="sm" type="submit">{t("markRead")}</Button>
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
