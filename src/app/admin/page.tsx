import { redirect } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { canAny } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { defaultDashboard } from "@/components/dashboard/dashboard-tabs";
import { PageHeader } from "@/components/ui/misc";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("adminDashboard");

/** Lands each role on its default dashboard (management → team → my work). */
export default async function AdminHome() {
  const tcfg = await getTranslations("cfg");
  const actor = await requireAdminPortal();
  if (!canAny(actor, [P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL])) {
    return <PageHeader title={tcfg("adminPortal")} description={tcfg("useTheMenuToManageConfiguration")} />;
  }
  redirect(defaultDashboard(actor));
}
