import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { CrudPage } from "@/components/admin/crud-page";
import { Alert } from "@/components/ui/misc";

export const metadata = { title: "Microsoft Tenants" };

export default async function TenantsPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_TENANTS)) notFound();
  return CrudPage({
    actor, entity: "tenants",
    extra: (
      <Alert className="mb-4">
        The app registration must be <strong>multi-tenant</strong> (“Accounts in any organizational directory”). Each external organization&apos;s
        admin grants consent once; then add its Tenant ID here. Disabling a tenant blocks sign-in and ends existing sessions for all of its users.
      </Alert>
    ),
  });
}
