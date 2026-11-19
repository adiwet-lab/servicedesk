import { requireActor } from "@/server/auth/get-actor";
import { TicketListPage } from "@/components/tickets/ticket-list-page";
import { canAccessAdminPortal } from "@/server/authz/guards";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const params = await searchParams;
  return (
    <TicketListPage actor={actor} view="search" title="Search" base="/search" params={params} admin={canAccessAdminPortal(actor)}
      description={params.q ? `Results for “${params.q}” across all tickets you are allowed to see.` : "Search by ticket number, subject, requester, email, employee ID or asset."} />
  );
}
