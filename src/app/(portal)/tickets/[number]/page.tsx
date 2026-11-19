import { requireActor } from "@/server/auth/get-actor";
import { TicketDetail } from "@/components/tickets/ticket-detail";

export const metadata = { title: "Ticket" };

export default async function TicketPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requireActor();
  const { number } = await params;
  const sp = await searchParams;
  return <TicketDetail actor={actor} idOrNumber={number} backHref="/tickets" created={sp.created === "1"} />;
}
