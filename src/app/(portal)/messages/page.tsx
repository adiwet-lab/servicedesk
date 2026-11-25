import { getTranslations } from "next-intl/server";
import { requireActor } from "@/server/auth/get-actor";
import { ChatInbox } from "@/components/chat/chat-inbox";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("messages");

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  return ChatInbox({
    actor, base: "/messages", ticketBase: "/tickets", title: (await getTranslations("pageTitle"))("messages"), mineOnly: true,
    description: (await getTranslations("chat"))("inboxMineDesc"), params: await searchParams,
  });
}
