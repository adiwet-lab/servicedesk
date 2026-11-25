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
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("supportAgents");

export default async function AgentsPage() {
  const tcfg = await getTranslations("cfg");
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
      <PageHeader title={tcfg("supportAgents")} description={tcfg("usersWhoBelongToAtLeast")} />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{tcfg("agent")}</TableHead><TableHead>{tcfg("organization")}</TableHead><TableHead>{tcfg("teams")}</TableHead><TableHead>{tcfg("roles")}</TableHead><TableHead>{tcfg("openTickets")}</TableHead><TableHead>{tcfg("status")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {agents.map((a) => (
              <TableRow key={a.id}>
                <TableCell><Link href={`/admin/system/users/${a.id}`} className="font-medium hover:underline">{a.displayName}</Link><p className="text-xs text-muted-foreground">{a.email}</p></TableCell>
                <TableCell className="text-sm">{a.tenant.name}{a.tenant.type === "VENDOR" && <Badge variant="warning" className="ml-1">{tcfg("external")}</Badge>}</TableCell>
                <TableCell className="space-x-1">{a.teamMemberships.map((m) => <Badge key={m.teamId} variant="secondary">{m.team.name}{m.role === "LEAD" ? " ★" : ""}</Badge>)}</TableCell>
                <TableCell className="text-sm">{a.roles.map((r) => r.role.name).join(", ")}</TableCell>
                <TableCell className="tabular-nums">{wl.get(a.id) ?? 0}</TableCell>
                <TableCell>{a.status === "ACTIVE" ? <Badge variant="success">{tcfg("active")}</Badge> : <Badge variant="destructive">{a.status}</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
