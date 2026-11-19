import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { listRoles } from "@/server/services/admin/users";
import { RoleEditor } from "@/components/admin/role-editor";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";

export const metadata = { title: "Roles" };

export default async function RolesPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_ROLES)) notFound();
  const [roles, perms] = await Promise.all([listRoles(actor), prisma.permission.findMany({ orderBy: [{ group: "asc" }, { code: "asc" }] })]);
  return (
    <div>
      <PageHeader title="Roles" description="Roles bundle permissions. Data scope (own / department / branch / team) is enforced server-side on top of permissions."
        actions={<RoleEditor role={null} permissions={perms} />} />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Role</TableHead><TableHead>Code</TableHead><TableHead>Permissions</TableHead><TableHead>Users</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {roles.map((r) => (
              <TableRow key={r.id}>
                <TableCell><p className="font-medium">{r.name} {r.isSystem && <Badge variant="outline">System</Badge>}</p><p className="text-xs text-muted-foreground">{r.description}</p></TableCell>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell className="max-w-md"><div className="flex flex-wrap gap-1">{r.permissions.map((p) => <Badge key={p.permissionId} variant="secondary" className="font-mono text-[10px]">{p.permission.code}</Badge>)}</div></TableCell>
                <TableCell className="tabular-nums">{r._count.users}</TableCell>
                <TableCell className="text-right">
                  <RoleEditor permissions={perms} role={{ id: r.id, code: r.code, name: r.name, description: r.description, defaultTicketVisibility: r.defaultTicketVisibility, isSystem: r.isSystem, permissions: r.permissions.map((p) => p.permission.code) }} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
