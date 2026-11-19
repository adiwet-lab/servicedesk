import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, PageHeader } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Outsource Teams" };

export default async function OutsourcePage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_TEAMS)) notFound();
  const teams = await prisma.supportTeam.findMany({
    where: { deletedAt: null, type: { in: ["VENDOR", "OUTSOURCE"] } },
    include: { tenant: true, members: { include: { user: true } } }, orderBy: { name: "asc" },
  });
  const soon = new Date(Date.now() + 14 * 86400000);
  return (
    <div className="space-y-5">
      <PageHeader title="Outsource Teams" description="External vendor and outsource support teams, their members and access expiry." />
      <Alert>External users sign in with their own Microsoft tenant, only see tickets owned by/assigned to their team, never see internal notes, and lose access automatically at their expiry date. Deactivate a user under User Management to cut access immediately.</Alert>
      {teams.map((t) => (
        <Card key={t.id} className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">{t.name} <Badge variant="secondary" className="ml-1">{t.type}</Badge> {!t.isActive && <Badge variant="outline">Inactive</Badge>}</CardTitle>
              <p className="text-sm text-muted-foreground">{t.tenant?.name ?? "No tenant linked"}</p>
            </div>
            <Link href={`/admin/support/teams/${t.id}`} className="text-sm text-primary hover:underline">Manage members</Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Member</TableHead><TableHead>Status</TableHead><TableHead>Access expires</TableHead></TableRow></TableHeader>
              <TableBody>
                {t.members.map((m) => {
                  const exp = m.user.accessExpiresAt;
                  return (
                    <TableRow key={m.userId}>
                      <TableCell><Link href={`/admin/system/users/${m.userId}`} className="font-medium hover:underline">{m.user.displayName}</Link><p className="text-xs text-muted-foreground">{m.user.email}</p></TableCell>
                      <TableCell>{m.user.status === "ACTIVE" ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">{m.user.status}</Badge>}</TableCell>
                      <TableCell>{exp ? <Badge variant={exp < new Date() ? "destructive" : exp < soon ? "warning" : "secondary"}>{formatDate(exp)}</Badge> : <Badge variant="warning">No expiry set</Badge>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
