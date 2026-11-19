import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { getTeamWithMembers } from "@/server/services/admin/users";
import { AuthorizationError, NotFoundError } from "@/server/authz/errors";
import { memberRoleAction, removeMemberAction } from "@/server/actions/admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { AddMemberForm } from "@/components/admin/add-member-form";

export const metadata = { title: "Team Members" };

export default async function TeamMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminPortal();
  const { id } = await params;
  let data;
  try { data = await getTeamWithMembers(actor, id); } catch (e) { if (e instanceof NotFoundError || e instanceof AuthorizationError) notFound(); throw e; }
  const { team, candidates } = data;
  return (
    <div className="space-y-5">
      <Link href="/admin/support/teams" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Support teams</Link>
      <PageHeader title={team.name} description={<span className="flex flex-wrap gap-2"><Badge variant="secondary">{team.type}</Badge><span>{team.code}</span>{team.tenant && <span>· {team.tenant.name}</span>}</span>} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add member</CardTitle>
          <CardDescription>{team.type === "INTERNAL" ? "Internal teams accept users from internal tenants." : "Vendor/outsource teams only accept users from the team's own Microsoft tenant."}</CardDescription>
        </CardHeader>
        <CardContent><AddMemberForm teamId={team.id} candidates={candidates} /></CardContent>
      </Card>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Member</TableHead><TableHead>Organization</TableHead><TableHead>Roles</TableHead><TableHead>Team role</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {team.members.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No members yet.</TableCell></TableRow>}
            {team.members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell><p className="font-medium">{m.user.displayName}</p><p className="text-xs text-muted-foreground">{m.user.email}</p></TableCell>
                <TableCell className="text-sm">{m.user.tenant.name}</TableCell>
                <TableCell className="space-x-1">{m.user.roles.map((r) => <Badge key={r.roleId} variant="secondary">{r.role.name}</Badge>)}</TableCell>
                <TableCell>{m.role === "LEAD" ? <Badge>Team Lead</Badge> : <Badge variant="outline">Member</Badge>}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <form action={memberRoleAction} className="inline">
                    <input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="userId" value={m.userId} />
                    <input type="hidden" name="role" value={m.role === "LEAD" ? "MEMBER" : "LEAD"} />
                    <Button variant="ghost" size="sm" type="submit">{m.role === "LEAD" ? "Make member" : "Make lead"}</Button>
                  </form>
                  <form action={removeMemberAction} className="inline">
                    <input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="userId" value={m.userId} />
                    <Button variant="ghost" size="sm" type="submit" aria-label="Remove"><Trash2 className="text-destructive" /> Remove</Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
