import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { listUsers } from "@/server/services/admin/users";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "User Management" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_USERS)) notFound();
  const sp = await searchParams;
  const tenants = await prisma.tenant.findMany({ orderBy: { name: "asc" } });
  const roles = await prisma.role.findMany({ orderBy: { name: "asc" } });
  const res = await listUsers(actor, { q: sp.q, tenant: sp.tenant, tenantType: sp.type, status: sp.status, role: sp.role, page: Number(sp.page ?? 1) });
  const rows = res.rows;
  const qs = (patch: Record<string, string>) => `?${new URLSearchParams({ ...(sp as Record<string, string>), ...patch }).toString()}`;
  return (
    <div>
      <PageHeader title={sp.type === "INTERNAL" ? "Employees" : "User Management"} description="Users from all authorized Microsoft tenants. Role, organization mapping, visibility scope and account status."
        actions={<Button asChild><Link href="/admin/system/users/new"><Plus /> Pre-create user</Link></Button>} />
      <Card className="overflow-hidden">
        <form method="get" className="flex flex-wrap items-end gap-2 border-b p-3">
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={sp.q} placeholder="Name, email, employee ID" className="pl-9" aria-label="Search users" />
          </div>
          <NativeSelect name="tenant" defaultValue={sp.tenant ?? ""} className="w-56" aria-label="Tenant"><option value="">All tenants</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
          <NativeSelect name="role" defaultValue={sp.role ?? ""} className="w-44" aria-label="Role"><option value="">All roles</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</NativeSelect>
          <NativeSelect name="status" defaultValue={sp.status ?? ""} className="w-36" aria-label="Status"><option value="">Any status</option><option>ACTIVE</option><option>PENDING</option><option>INACTIVE</option></NativeSelect>
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>User</TableHead><TableHead>Organization</TableHead><TableHead>Department / Branch</TableHead><TableHead>Roles</TableHead><TableHead>Teams</TableHead><TableHead>Status</TableHead><TableHead>Last sign-in</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell><Link href={`/admin/system/users/${u.id}`} className="font-medium text-primary hover:underline">{u.displayName}</Link><p className="text-xs text-muted-foreground">{u.email}{u.employeeId ? ` · ${u.employeeId}` : ""}</p></TableCell>
                <TableCell className="text-sm">{u.tenant.name}{u.tenant.type === "VENDOR" && <Badge variant="warning" className="ml-1">External</Badge>}</TableCell>
                <TableCell className="text-xs"><div>{u.department?.name ?? "—"}</div><div className="text-muted-foreground">{u.branch?.name}</div></TableCell>
                <TableCell className="space-x-1">{u.roles.map((r) => <Badge key={r.roleId} variant="secondary">{r.role.name}</Badge>)}</TableCell>
                <TableCell className="text-xs">{u.teamMemberships.map((m) => m.team.name).join(", ") || "—"}</TableCell>
                <TableCell>{u.status === "ACTIVE" ? <Badge variant="success">Active</Badge> : u.status === "PENDING" ? <Badge variant="warning">Pending</Badge> : <Badge variant="destructive">Inactive</Badge>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.lastLoginAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-3 py-3 text-sm text-muted-foreground">
          <span>{res.total} users · page {res.page} of {res.pages}</span>
          <div className="flex gap-1">
            {res.page > 1 && <Link className="rounded-md border p-1.5 hover:bg-accent" href={qs({ page: String(res.page - 1) })}><ChevronLeft className="size-4" /></Link>}
            {res.page < res.pages && <Link className="rounded-md border p-1.5 hover:bg-accent" href={qs({ page: String(res.page + 1) })}><ChevronRight className="size-4" /></Link>}
          </div>
        </div>
      </Card>
    </div>
  );
}
