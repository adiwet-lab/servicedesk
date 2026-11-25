import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getUserFormOptions } from "@/server/services/admin/users";
import { UserForm } from "@/components/admin/user-form";
import { PageHeader } from "@/components/ui/misc";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("newUser");

export default async function NewUserPage() {
  const tsys = await getTranslations("sysadm");
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_USERS)) notFound();
  const o = await getUserFormOptions();
  return (
    <div>
      <PageHeader title={tsys("preCreateUser")} description={tsys("preCreateAUserToAssign")} />
      <UserForm userId={null} vendor={false} initial={{ status: "ACTIVE", ticketVisibility: "OWN", roleIds: [] }}
        tenants={o.tenants} companies={o.companies} departments={o.departments} branches={o.branches} locations={o.locations} roles={o.roles} managers={o.managers} />
    </div>
  );
}
