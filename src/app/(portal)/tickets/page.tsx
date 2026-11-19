import { requireActor } from "@/server/auth/get-actor";
import { TicketListPage } from "@/components/tickets/ticket-list-page";

export const metadata = { title: "My Tickets" };

export default async function MyTicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  return <TicketListPage actor={actor} view="my" title="My Tickets" description="Tickets you have requested." base="/tickets" params={await searchParams} />;
}
