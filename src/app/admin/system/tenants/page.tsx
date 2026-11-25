import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { CrudPage } from "@/components/admin/crud-page";
import { Alert } from "@/components/ui/misc";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("microsoftTenants");

export default async function TenantsPage() {
  const tsys = await getTranslations("sysadm");
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_TENANTS)) notFound();
  return CrudPage({
    actor, entity: "tenants",
    extra: (
      <Alert className="mb-4">
        {tsys.rich("tenantNote", { b: (c) => <strong>{c}</strong> })}
      </Alert>
    ),
  });
}
