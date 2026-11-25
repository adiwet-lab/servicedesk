import { prisma } from "@/server/db";
import { requireActor } from "@/server/auth/get-actor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "next-intl/server";
import { currentLocale, getFormat } from "@/i18n/server";
import { ln } from "@/lib/localized";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("profile");


export default async function ProfilePage() {
  const actor = await requireActor();
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    include: { tenant: true, company: true, department: true, branch: true, location: true, manager: true,
      roles: { include: { role: true } }, teamMemberships: { include: { team: true } } },
  });
  const [t, tv, ts, tr, f, locale] = await Promise.all([getTranslations("profile"), getTranslations("visibility"), getTranslations("userStatus"), getTranslations("roles"), getFormat(), currentLocale()]);
  const L = (e: { name: string; nameTh: string | null } | null) => (e ? ln(e, locale) : null);
  const rows: [string, React.ReactNode][] = [
    [t("email"), u.email], [t("employeeId"), u.employeeId], [t("jobTitle"), u.jobTitle], [t("company"), u.company?.name], [t("department"), L(u.department)],
    [t("branch"), L(u.branch)], [t("location"), L(u.location)], [t("manager"), u.manager?.displayName], [t("contactNumber"), u.contactNumber],
    [t("tenant"), `${u.tenant.name}${u.tenant.type === "VENDOR" ? ` · ${t("external")}` : ""}`],
    [t("tenantId"), <code key="t" className="text-xs">{u.tenant.entraTenantId}</code>],
    [t("userId"), <code key="o" className="text-xs">{u.entraObjectId ?? t("notLinked")}</code>],
    [t("visibility"), tv(u.ticketVisibility)], [t("status"), <Badge key="s" variant={u.status === "ACTIVE" ? "success" : "destructive"}>{ts(u.status)}</Badge>],
    [t("accessExpires"), u.accessExpiresAt ? f.dateTime(u.accessExpiresAt) : t("never")], [t("lastSignIn"), f.dateTime(u.lastLoginAt)],
    [t("language"), <div key="l" className="flex flex-wrap items-center gap-2"><LanguageSwitcher /><span className="text-xs text-muted-foreground">{t("languageHint")}</span></div>],
  ];
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title={(await getTranslations("pageTitle"))("profile")} description={t("description")} />
      <Card>
        <CardContent className="flex items-center gap-4 pt-5">
          <Avatar name={u.displayName} className="size-14 text-lg" />
          <div>
            <p className="text-lg font-semibold">{u.displayName}</p>
            <div className="mt-1 flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.roleId}>{tr.has(r.role.code as never) ? tr(r.role.code as never) : r.role.name}</Badge>)}</div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("details")}</CardTitle></CardHeader>
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
          <CardHeader><CardTitle className="text-base">{t("supportTeams")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {u.teamMemberships.map((m) => <Badge key={m.teamId} variant="secondary">{ln(m.team, locale)}{m.role === "LEAD" ? ` · ${t("lead")}` : ""}</Badge>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
