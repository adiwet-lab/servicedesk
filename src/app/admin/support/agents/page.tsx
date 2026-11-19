import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";

export const metadata = { title: "Support Agents" };

export default async function AgentsPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_TEAMS)) notFound();
  const agents = await prisma.user.findMany({
    where: { deletedAt: null, teamMemberships: { some: {} } },
    include: { tenant: true, teamMemberships: { include: { team: true } }, roles: { include: { role: true } } },
    orderBy: { displayName: "asc" },
  });
  const workload = await prisma.ticket.groupBy({
    by: ["assignedAgentId"], where: { deletedAt: null, assignedAgentId: { in: agents.map((a) => a.id) }, status: { kind: { in: ["NEW", "OPEN", "WAITING"] } } }, _count: { _all: true },
  });
  const wl = new Map(workload.map((w) => [w.assignedAgentId, w._count._all]));
  return (
    <div>
      <PageHeader title="Support Agents" description="Users who belong to at least one support team. Manage membership from Support Teams." />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Agent</TableHead><TableHead>Organization</TableHead><TableHead>Teams</TableHead><TableHead>Roles</TableHead><TableHead>Open tickets</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {agents.map((a) => (
              <TableRow key={a.id}>
                <TableCell><Link href={`/admin/system/users/${a.id}`} className="font-medium hover:underline">{a.displayName}</Link><p className="text-xs text-muted-foreground">{a.email}</p></TableCell>
                <TableCell className="text-sm">{a.tenant.name}{a.tenant.type === "VENDOR" && <Badge variant="warning" className="ml-1">External</Badge>}</TableCell>
                <TableCell className="space-x-1">{a.teamMemberships.map((m) => <Badge key={m.teamId} variant="secondary">{m.team.name}{m.role === "LEAD" ? " ★" : ""}</Badge>)}</TableCell>
                <TableCell className="text-sm">{a.roles.map((r) => r.role.name).join(", ")}</TableCell>
                <TableCell className="tabular-nums">{wl.get(a.id) ?? 0}</TableCell>
                <TableCell>{a.status === "ACTIVE" ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">{a.status}</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
