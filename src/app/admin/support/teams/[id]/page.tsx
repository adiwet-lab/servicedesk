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
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { currentLocale } from "@/i18n/server";
import { ln } from "@/lib/localized";

export const generateMetadata = pageTitle("teamMembers");

export default async function TeamMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await currentLocale();
  const tcfg = await getTranslations("cfg");
  const actor = await requireAdminPortal();
  const { id } = await params;
  let data;
  try { data = await getTeamWithMembers(actor, id); } catch (e) { if (e instanceof NotFoundError || e instanceof AuthorizationError) notFound(); throw e; }
  const { team, candidates } = data;
  return (
    <div className="space-y-5">
      <Link href="/admin/support/teams" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {tcfg("supportTeams")}</Link>
      <PageHeader title={ln(team, locale)} description={<span className="flex flex-wrap gap-2"><Badge variant="secondary">{team.type}</Badge><span>{team.code}</span>{team.tenant && <span>· {team.tenant.name}</span>}</span>} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tcfg("addMember")}</CardTitle>
          <CardDescription>{team.type === "INTERNAL" ? tcfg("internalTeamsAcceptUsersFromInternal") : tcfg("vendorOutsourceTeamsOnlyAcceptUsers")}</CardDescription>
        </CardHeader>
        <CardContent><AddMemberForm teamId={team.id} candidates={candidates} /></CardContent>
      </Card>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{tcfg("member")}</TableHead><TableHead>{tcfg("organization")}</TableHead><TableHead>{tcfg("roles")}</TableHead><TableHead>{tcfg("teamRole")}</TableHead><TableHead className="text-right">{tcfg("actions")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {team.members.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{tcfg("noMembersYet")}</TableCell></TableRow>}
            {team.members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell><p className="font-medium">{m.user.displayName}</p><p className="text-xs text-muted-foreground">{m.user.email}</p></TableCell>
                <TableCell className="text-sm">{m.user.tenant.name}</TableCell>
                <TableCell className="space-x-1">{m.user.roles.map((r) => <Badge key={r.roleId} variant="secondary">{r.role.name}</Badge>)}</TableCell>
                <TableCell>{m.role === "LEAD" ? <Badge>{tcfg("teamLead")}</Badge> : <Badge variant="outline">{tcfg("member")}</Badge>}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <form action={memberRoleAction} className="inline">
                    <input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="userId" value={m.userId} />
                    <input type="hidden" name="role" value={m.role === "LEAD" ? "MEMBER" : "LEAD"} />
                    <Button variant="ghost" size="sm" type="submit">{m.role === "LEAD" ? tcfg("makeMember") : tcfg("makeLead")}</Button>
                  </form>
                  <form action={removeMemberAction} className="inline">
                    <input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="userId" value={m.userId} />
                    <Button variant="ghost" size="sm" type="submit" aria-label={tcfg("remove")}><Trash2 className="text-destructive" /> {tcfg("remove")}</Button>
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
