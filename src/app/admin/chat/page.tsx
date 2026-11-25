import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { canAny } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { ChatInbox } from "@/components/chat/chat-inbox";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("supportChat");

export default async function SupportChatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  if (!canAny(actor, [P.TICKET_READ_TEAM, P.TICKET_READ_ALL])) notFound();
  return ChatInbox({
    actor, base: "/admin/chat", ticketBase: "/admin/tickets", title: (await getTranslations("pageTitle"))("supportChat"),
    description: (await getTranslations("chat"))("inboxStaffDesc"),
    params: await searchParams,
  });
}
