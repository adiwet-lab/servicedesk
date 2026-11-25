import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { CrudPage } from "@/components/admin/crud-page";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("supportTeams");

export default async function TeamsPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_TEAMS)) notFound();
  return CrudPage({ actor, entity: "teams", rowLink: { label: (await getTranslations("cfg"))("membersLink"), hrefPrefix: "/admin/support/teams/" } });
}
