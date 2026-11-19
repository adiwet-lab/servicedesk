import { requireActor } from "@/server/auth/get-actor";
import { ChatInbox } from "@/components/chat/chat-inbox";

export const metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  return ChatInbox({
    actor, base: "/messages", ticketBase: "/tickets", title: "Messages", mineOnly: true,
    description: "Conversations with IT Support about your tickets.", params: await searchParams,
  });
}
