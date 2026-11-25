import { requireActor } from "@/server/auth/get-actor";
import { TicketDetail } from "@/components/tickets/ticket-detail";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("ticket");

export default async function TicketPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ created?: string; task?: string; tab?: string }> }) {
  const actor = await requireActor();
  const { number } = await params;
  const sp = await searchParams;
  return <TicketDetail actor={actor} idOrNumber={number} backHref="/tickets" created={sp.created === "1"} initialTab={sp.task ? "tasks" : sp.tab} />;
}
