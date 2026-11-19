import { requireActor } from "@/server/auth/get-actor";
import { TicketListPage } from "@/components/tickets/ticket-list-page";

export const metadata = { title: "Branch Tickets" };

export default async function BranchTicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  return <TicketListPage actor={actor} view="branch" title="Branch Tickets" description="Tickets for your branch (confidential tickets excluded)." base="/tickets/branch" params={await searchParams} />;
}
