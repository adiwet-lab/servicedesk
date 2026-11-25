import { requireActor } from "@/server/auth/get-actor";
import { TicketListPage } from "@/components/tickets/ticket-list-page";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("branchTickets");

export default async function BranchTicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  return <TicketListPage actor={actor} view="branch" title={(await getTranslations("pageTitle"))("branchTickets")} description={(await getTranslations("portal"))("branchTicketsDesc")} base="/tickets/branch" params={await searchParams} />;
}
