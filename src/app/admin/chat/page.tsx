import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { isVendor } from "@/server/authz/actor";
import { canAny } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { chatFilterOptions, chatFilterSchema, chatQueue, getChatFilter } from "@/server/services/chat-cases";
import { currentLocale } from "@/i18n/server";
import { pageTitle } from "@/i18n/metadata";
import { ChatInbox } from "@/components/chat/chat-inbox";
import { ChatQueuePanel } from "@/components/chat/chat-console";
import { CasePane } from "@/components/chat/case-pane";
import { StaffCaseActions } from "@/components/chat/staff-case-actions";
import { cn } from "@/lib/utils";

export const generateMetadata = pageTitle("supportChat");

/**
 * Staff chat console (Phase 9): shared queue with views and a saved personal filter on the left,
 * the conversation with claim / status / assign actions on the right. Vendor staff (no chat.queue)
 * keep the conversation inbox limited to their own work.
 */
export default async function SupportChatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  if (!canAny(actor, [P.TICKET_READ_TEAM, P.TICKET_READ_ALL])) notFound();
  const params = await searchParams;
  if (isVendor(actor) || !actor.permissions.has(P.CHAT_QUEUE)) {
    return ChatInbox({
      actor, base: "/admin/chat", ticketBase: "/admin/tickets", title: (await getTranslations("pageTitle"))("supportChat"),
      description: (await getTranslations("chat"))("inboxStaffDesc"), params,
    });
  }
  const [t, locale, saved] = await Promise.all([getTranslations("chatConsole"), currentLocale(), getChatFilter(actor)]);
  const view = chatFilterSchema.shape.view.safeParse(params.view);
  const filter = view.success && params.view ? { ...saved, view: view.data } : saved;
  const [options, queue] = await Promise.all([chatFilterOptions(actor, locale), chatQueue(actor, filter, { locale })]);
  const selected = params.t;

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-card lg:-m-6" data-testid="chat-console">
      <aside className={cn("w-full shrink-0 border-r md:block md:w-96", selected ? "hidden" : "block")}>
        <ChatQueuePanel initialFilter={filter} savedFilter={saved} options={options} initialRows={queue.rows} selected={selected} />
      </aside>
      <section className={cn("min-w-0 flex-1 flex-col bg-background", selected ? "flex" : "hidden md:flex")}>
        {selected ? (
          <CasePane actor={actor} ticket={selected} backHref="/admin/chat" detailHref={`/admin/tickets/${encodeURIComponent(selected)}`}
            staffPanel={<StaffCaseActions actor={actor} ticket={selected} />} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <MessagesSquare className="size-8" />
            <p className="font-medium text-foreground">{t("pickConversation")}</p>
            <p>{t("pickConversationHint")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
