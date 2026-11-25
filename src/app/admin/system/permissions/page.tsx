import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { canAny } from "@/server/authz/guards";
import { PERMISSIONS as P, VENDOR_FORBIDDEN_PERMISSIONS } from "@/server/authz/permissions";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, PageHeader } from "@/components/ui/misc";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("permissions");

export default async function PermissionsPage() {
  const tsys = await getTranslations("sysadm");
  const actor = await requireAdminPortal();
  if (!canAny(actor, [P.ADMIN_ROLES, P.ADMIN_USERS])) notFound();
  const [perms, roles] = await Promise.all([
    prisma.permission.findMany({ orderBy: [{ group: "asc" }, { code: "asc" }] }),
    prisma.role.findMany({ include: { permissions: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title={tsys("permissionMatrix")} description={tsys("liveRolePermissionMatrixFromThe")} />
      <Alert className="mb-4">{tsys.rich("vendorPermNote", { b: (c) => <strong>{c}</strong> })}</Alert>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{tsys("permission")}</TableHead>
              {roles.map((r) => <TableHead key={r.id} className="text-center">{r.name}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {perms.map((p) => (
              <TableRow key={p.id}>
                <TableCell><code className="text-xs">{p.code}</code>{VENDOR_FORBIDDEN_PERMISSIONS.includes(p.code as never) && <span className="ml-1 text-amber-600">✱</span>}<p className="text-xs text-muted-foreground">{p.description}</p></TableCell>
                {roles.map((r) => <TableCell key={r.id} className="text-center">{r.permissions.some((rp) => rp.permissionId === p.id) ? <Check className="mx-auto size-4 text-success" /> : <span className="text-muted-foreground/40">·</span>}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
