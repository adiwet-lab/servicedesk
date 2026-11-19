import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { canAny } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { ChatInbox } from "@/components/chat/chat-inbox";

export const metadata = { title: "Support Chat" };

export default async function SupportChatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  if (!canAny(actor, [P.TICKET_READ_TEAM, P.TICKET_READ_ALL])) notFound();
  return ChatInbox({
    actor, base: "/admin/chat", ticketBase: "/admin/tickets", title: "Support Chat",
    description: "Ticket conversations you can access, newest first. Internal notes are only shown to authorized staff.",
    params: await searchParams,
  });
}
