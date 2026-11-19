import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getUserFormOptions } from "@/server/services/admin/users";
import { UserForm } from "@/components/admin/user-form";
import { PageHeader } from "@/components/ui/misc";

export const metadata = { title: "New User" };

export default async function NewUserPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_USERS)) notFound();
  const o = await getUserFormOptions();
  return (
    <div>
      <PageHeader title="Pre-create user" description="Pre-create a user to assign roles and organization before their first Microsoft sign-in. The account links on first sign-in from the same tenant with a matching email." />
      <UserForm userId={null} vendor={false} initial={{ status: "ACTIVE", ticketVisibility: "OWN", roleIds: [] }}
        tenants={o.tenants} companies={o.companies} departments={o.departments} branches={o.branches} locations={o.locations} roles={o.roles} managers={o.managers} />
    </div>
  );
}
