import { requireActor } from "@/server/auth/get-actor";
import { TicketListPage } from "@/components/tickets/ticket-list-page";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("departmentTickets");

export default async function DepartmentTicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  return <TicketListPage actor={actor} view="department" title={(await getTranslations("pageTitle"))("departmentTickets")} description={(await getTranslations("portal"))("deptTicketsDesc")} base="/tickets/department" params={await searchParams} />;
}
