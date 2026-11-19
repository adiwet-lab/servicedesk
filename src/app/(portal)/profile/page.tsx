import { prisma } from "@/server/db";
import { requireActor } from "@/server/auth/get-actor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Profile" };

const VIS = { OWN: "Own tickets only", OWN_DEPT: "Own + Department", OWN_BRANCH: "Own + Branch", OWN_DEPT_BRANCH: "Own + Department + Branch" };

export default async function ProfilePage() {
  const actor = await requireActor();
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    include: { tenant: true, company: true, department: true, branch: true, location: true, manager: true,
      roles: { include: { role: true } }, teamMemberships: { include: { team: true } } },
  });
  const rows: [string, React.ReactNode][] = [
    ["Email", u.email], ["Employee ID", u.employeeId], ["Job title", u.jobTitle], ["Company", u.company?.name], ["Department", u.department?.name],
    ["Branch", u.branch?.name], ["Location", u.location?.name], ["Manager", u.manager?.displayName], ["Contact number", u.contactNumber],
    ["Organization (tenant)", `${u.tenant.name}${u.tenant.type === "VENDOR" ? " · External" : ""}`],
    ["Microsoft Tenant ID", <code key="t" className="text-xs">{u.tenant.entraTenantId}</code>],
    ["Microsoft User ID", <code key="o" className="text-xs">{u.entraObjectId ?? "Not linked yet (first Microsoft sign-in links it)"}</code>],
    ["Ticket visibility", VIS[u.ticketVisibility]], ["Account status", <Badge key="s" variant={u.status === "ACTIVE" ? "success" : "destructive"}>{u.status}</Badge>],
    ["Access expires", u.accessExpiresAt ? formatDateTime(u.accessExpiresAt) : "Never"], ["Last sign-in", formatDateTime(u.lastLoginAt)],
  ];
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Profile" description="Your profile is synchronised from Microsoft 365 and maintained by IT administrators." />
      <Card>
        <CardContent className="flex items-center gap-4 pt-5">
          <Avatar name={u.displayName} className="size-14 text-lg" />
          <div>
            <p className="text-lg font-semibold">{u.displayName}</p>
            <div className="mt-1 flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.roleId}>{r.role.name}</Badge>)}</div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="divide-y">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[12rem_1fr] gap-2 py-2 text-sm"><dt className="text-muted-foreground">{k}</dt><dd>{v ?? "—"}</dd></div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {u.teamMemberships.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Support teams</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {u.teamMemberships.map((m) => <Badge key={m.teamId} variant="secondary">{m.team.name}{m.role === "LEAD" ? " · Lead" : ""}</Badge>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
