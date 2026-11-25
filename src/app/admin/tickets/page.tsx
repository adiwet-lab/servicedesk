import { requireAdminPortal } from "@/server/auth/get-actor";
import { TICKET_VIEWS, type TicketView } from "@/server/services/tickets";
import { TicketListPage } from "@/components/tickets/ticket-list-page";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("tickets");

export default async function AdminTicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const view = (TICKET_VIEWS as readonly string[]).includes(params.view ?? "") ? (params.view as TicketView) : "all";
  const t = await getTranslations("adminTickets");
  const key = (["all", "unassigned", "myteam", "assigned", "overdue", "breached"] as const).find((k) => k === view) ?? "all";
  const [title, desc] = [t(`${key}.title`), t(`${key}.desc`)];
  return <TicketListPage actor={actor} view={view} title={title} description={desc} base="/admin/tickets" params={params} admin />;
}
