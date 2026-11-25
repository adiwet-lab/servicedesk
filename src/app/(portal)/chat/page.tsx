import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MessageSquarePlus } from "lucide-react";
import { requireActor } from "@/server/auth/get-actor";
import { chatStartOptions, followUpList } from "@/server/services/chat-cases";
import { currentLocale, getFormat } from "@/i18n/server";
import { pageTitle } from "@/i18n/metadata";
import { ColorBadge } from "@/components/ui/badge";
import { ChatStart } from "@/components/chat/chat-start";
import { CasePane } from "@/components/chat/case-pane";
import { InboxLiveRefresh } from "@/components/chat/inbox-live";
import { cn } from "@/lib/utils";

export const generateMetadata = pageTitle("chat");

/** LINE-style chat: list of open cases on the left, guided start or the case conversation on the right. */
export default async function ChatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const params = await searchParams;
  const [t, locale, fmt] = await Promise.all([getTranslations("chatFlow"), currentLocale(), getFormat()]);
  const [cases, options] = await Promise.all([followUpList(actor, locale), chatStartOptions(actor, locale)]);
  const selected = params.t;
  const initial = params.new === "1" ? "new" : params.follow === "1" ? "follow" : "welcome";

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-card lg:-m-6" data-testid="chat-page">
      <InboxLiveRefresh />
      <aside className={cn("w-full shrink-0 flex-col border-r md:flex md:w-80", selected || params.new || params.follow ? "hidden" : "flex")} data-testid="chat-list">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="font-semibold">{t("conversations")}</h1>
          <Link href="/chat?new=1" className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground" data-testid="chat-start-new"><MessageSquarePlus className="size-3.5" /> {t("startNew")}</Link>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {cases.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{t("noConversations")}</li>}
          {cases.map((c) => (
            <li key={c.id}>
              <Link href={`/chat?t=${encodeURIComponent(c.number)}`} className={cn("flex gap-3 border-b px-4 py-3 hover:bg-accent", selected === c.number && "bg-primary/5")} data-testid="chat-list-item">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-xs"><span className="font-mono text-primary">{c.number}</span><ColorBadge color={c.status.color}>{c.status.name}</ColorBadge></p>
                  <p className="truncate text-sm font-medium">{c.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.preview}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">{fmt.time(c.lastAt)}</span>
                  {c.unread > 0 && <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">{c.unread}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/tickets/new" className="border-t px-4 py-2 text-center text-xs text-muted-foreground hover:text-foreground">{t("useForm")}</Link>
      </aside>
      <section className={cn("min-w-0 flex-1 flex-col bg-background", selected || params.new || params.follow ? "flex" : "hidden md:flex")}>
        {selected ? (
          <CasePane actor={actor} ticket={selected} created={params.created === "1"} backHref="/chat" detailHref={`/tickets/${encodeURIComponent(selected)}`} />
        ) : (
          <ChatStart key={initial} options={options} userName={actor.displayName}
            followUps={cases.map((c) => ({ id: c.id, number: c.number, subject: c.subject, status: c.status, unread: c.unread }))} initial={initial} />
        )}
      </section>
    </div>
  );
}
