import { requireActor } from "@/server/auth/get-actor";
import { TicketListPage } from "@/components/tickets/ticket-list-page";
import { canAccessAdminPortal } from "@/server/authz/guards";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("search");

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const params = await searchParams;
  const [tp, tt] = await Promise.all([getTranslations("portal"), getTranslations("pageTitle")]);
  return (
    <TicketListPage actor={actor} view="search" title={tt("search")} base="/search" params={params} admin={canAccessAdminPortal(actor)}
      description={params.q ? tp("searchResults", { q: params.q }) : tp("searchHint")} />
  );
}
