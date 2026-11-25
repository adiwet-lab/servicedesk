import { requireAdminPortal } from "@/server/auth/get-actor";
import { TICKET_VIEWS, type TicketView } from "@/server/services/tickets";
import { TicketListPage } from "@/components/tickets/ticket-list-page";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("tickets");

const TITLES: Partial<Record<TicketView, [string, string]>> = {
  all: ["All Tickets", "Every ticket within your access scope."],
  unassigned: ["Unassigned Tickets", "Open tickets waiting for an agent."],
  myteam: ["My Team Tickets", "Tickets owned by your support teams."],
  assigned: ["Assigned to Me", "Tickets where you are the responsible agent."],
  overdue: ["Overdue Tickets", "Open tickets past their resolution due date."],
  breached: ["SLA Breached", "Tickets that breached or are breaching SLA."],
};

export default async function AdminTicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const view = (TICKET_VIEWS as readonly string[]).includes(params.view ?? "") ? (params.view as TicketView) : "all";
  const [title, desc] = TITLES[view] ?? TITLES.all!;
  return <TicketListPage actor={actor} view={view} title={title} description={desc} base="/admin/tickets" params={params} admin />;
}
