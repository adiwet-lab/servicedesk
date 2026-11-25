import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { NotFoundError } from "@/server/authz/errors";
import { getUserForEdit, getUserFormOptions } from "@/server/services/admin/users";
import { revokeSessionsAction } from "@/server/actions/admin";
import { UserForm } from "@/components/admin/user-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";

import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/i18n/server";

export const generateMetadata = pageTitle("editUser");

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const tsys = await getTranslations("sysadm");
  const fmt = await getFormat();
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_USERS)) notFound();
  const { id } = await params;
  let user;
  try { user = await getUserForEdit(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const o = await getUserFormOptions();
  return (
    <div className="space-y-4">
      <Link href="/admin/system/users" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {tsys("users")}</Link>
      <PageHeader title={user.displayName}
        description={<span className="flex flex-wrap items-center gap-2">{user.email} · {user.tenant.name} {user.tenant.type === "VENDOR" && <Badge variant="warning">{tsys("external")}</Badge>}
          <span className="font-mono text-xs">{tsys("oidLine", { oid: user.entraObjectId ?? tsys("notLinked") })}</span> · {tsys("lastSignInAt", { at: fmt.dateTime(user.lastLoginAt) })}</span>}
        actions={<form action={revokeSessionsAction}><input type="hidden" name="userId" value={user.id} /><Button variant="outline" type="submit"><LogOut /> {tsys("signOutEverywhere")}</Button></form>} />
      <UserForm
        userId={user.id}
        vendor={user.tenant.type === "VENDOR"}
        initial={{
          displayName: user.displayName, employeeId: user.employeeId, jobTitle: user.jobTitle, contactNumber: user.contactNumber,
          companyId: user.companyId, departmentId: user.departmentId, branchId: user.branchId, locationId: user.locationId, managerId: user.managerId,
          status: user.status, ticketVisibility: user.ticketVisibility, accessExpiresAt: user.accessExpiresAt?.toISOString().slice(0, 10) ?? null,
          roleIds: user.roles.map((r) => r.roleId),
        }}
        tenants={o.tenants} companies={o.companies} departments={o.departments} branches={o.branches} locations={o.locations}
        roles={o.roles} managers={o.managers}
      />
    </div>
  );
}
