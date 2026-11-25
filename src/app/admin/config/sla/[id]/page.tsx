import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getSlaProfileDetail } from "@/server/services/admin/system";
import { dailyWorkingMinutes } from "@/server/domain/sla-engine";
import type { WeeklySchedule } from "@/server/domain/sla-calendar";
import { SlaTargetsForm } from "@/components/admin/sla-targets-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("slaTargets");

export default async function SlaTargetsPage({ params }: { params: Promise<{ id: string }> }) {
  const tcfg = await getTranslations("cfg");
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_SLA)) notFound();
  const d = await getSlaProfileDetail(actor, (await params).id);
  if (!d) notFound();
  const { profile, priorities, calendar } = d;
  const dayLen = dailyWorkingMinutes(calendar ? { timezone: calendar.timezone, schedule: calendar.schedule as WeeklySchedule, holidays: [] } : null);
  const rows = priorities.map((p) => {
    const t = profile.targets.find((x) => x.priorityId === p.id);
    return { priorityId: p.id, code: p.code, name: p.name, color: p.color, responseMinutes: t?.responseMinutes ?? 240, resolutionMinutes: t?.resolutionMinutes ?? 1440, businessHoursOnly: t?.businessHoursOnly ?? true };
  });
  return (
    <div className="max-w-5xl space-y-5">
      <Link href="/admin/config/sla" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {tcfg("slaProfiles")}</Link>
      <PageHeader title={tcfg("slaTargetsTitle", { name: profile.name })}
        description={<>{tcfg("calendar")} <Link className="text-primary hover:underline" href="/admin/config/business-hours">{calendar?.name ?? tcfg("none247")}</Link> {calendar && `(${calendar.timezone})`} · {tcfg("warningAt", { p: profile.warningPercent })} {profile.isDefault && <Badge className="ml-1">{tcfg("default")}</Badge>}</>} />
      <SlaTargetsForm profileId={profile.id} rows={rows} businessDayMinutes={dayLen} />
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">{tcfg("escalationRules")}</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {profile.escalations.length === 0 ? <p className="text-muted-foreground">{tcfg("none")}</p> : (
              <ul className="space-y-1">{profile.escalations.map((e) => (
                <li key={e.id} className={e.isActive ? "" : "opacity-50"}>{tcfg("escalationLine", { clock: tcfg(`clockName.${e.clock}`), p: e.atPercent, actions: [e.notifyTeamLead && tcfg("notifyLeads"), e.escalateToTeam && tcfg("transferTo", { team: e.escalateToTeam.name })].filter(Boolean).join(" + ") })}</li>
              ))}</ul>
            )}
            <Link href="/admin/config/escalations" className="mt-2 inline-block text-primary hover:underline">{tcfg("manageEscalationRules")}</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{tcfg("usedBy")}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {profile.isDefault && <p>{tcfg("allTicketsWithoutAMoreSpecific")}</p>}
            {profile.categories.map((c, i) => <p key={i}>{tcfg("categoryLine", { path: `${c.parent ? `${c.parent.name} › ` : ""}${c.name}` })}</p>)}
            {profile.teams.map((t, i) => <p key={i}>{tcfg("teamLine", { name: t.name })}</p>)}
            {!profile.isDefault && !profile.categories.length && !profile.teams.length && <p className="text-muted-foreground">{tcfg("notAssignedToAnyCategoryOr")}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
