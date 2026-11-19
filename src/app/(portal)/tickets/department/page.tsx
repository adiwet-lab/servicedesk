import { requireActor } from "@/server/auth/get-actor";
import { TicketListPage } from "@/components/tickets/ticket-list-page";

export const metadata = { title: "Department Tickets" };

export default async function DepartmentTicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  return <TicketListPage actor={actor} view="department" title="Department Tickets" description="Tickets raised by colleagues in your department (confidential tickets excluded)." base="/tickets/department" params={await searchParams} />;
}
