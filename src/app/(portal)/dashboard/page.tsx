import Link from "next/link";
import { redirect } from "next/navigation";
import { PlusCircle } from "lucide-react";
import { requireActor } from "@/server/auth/get-actor";
import { can, canAccessAdminPortal } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { listTickets, ticketSummary, availableViews } from "@/server/services/tickets";
import { unreadCounts } from "@/server/services/messages";
import { ticketListQuerySchema } from "@/lib/validation/ticket";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi";
import { TicketTable } from "@/components/tickets/ticket-table";
import { KnownIssuesBanner } from "@/components/incidents/known-issues";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { currentLocale } from "@/i18n/server";
import { ln } from "@/lib/localized";

export const generateMetadata = pageTitle("dashboard");

export default async function DashboardPage() {
  const actor = await requireActor();
  // External/support-only users without a requester role land in the support portal.
  if (!can(actor, P.TICKET_READ_OWN) && canAccessAdminPortal(actor)) redirect("/admin");

  const views = availableViews(actor);
  const summary = await ticketSummary(actor, { requesterId: actor.id });
  const recent = views.has("my") ? await listTickets(actor, "my", ticketListQuerySchema.parse({ pageSize: 10 })) : null;
  const unread = recent ? await unreadCounts(actor, recent.rows.map((r) => r.id)) : {};
  const [t, locale] = await Promise.all([getTranslations("portal"), currentLocale()]);

  return (
    <div>
      <PageHeader
        title={t("welcome", { name: actor.displayName.split(" ")[0] ?? "" })}
        description={t("dashboardDesc")}
        actions={can(actor, P.TICKET_CREATE) && <Button asChild><Link href="/tickets/new"><PlusCircle /> {t("createTicket")}</Link></Button>}
      />
      <div className="mb-5"><KnownIssuesBanner actor={actor} /></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label={t("totalMyTickets")} value={summary.total} href="/tickets" color="#3b82f6" />
        {summary.statuses.map((s) => (
          <KpiCard key={s.id} label={ln(s, locale)} value={s.count} color={s.color} href={`/tickets?status=${s.id}`} />
        ))}
        <KpiCard label={t("overdue")} value={summary.overdue} tone="danger" color="#ef4444" />
      </div>
      {recent && (
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">{t("recentTickets")}</CardTitle>
            <Link href="/tickets" className="text-sm text-primary hover:underline">{t("viewAll")}</Link>
          </CardHeader>
          <CardContent className="p-0">
            <TicketTable rows={recent.rows} total={recent.total} page={1} pages={1} base="/tickets" params={{}} unread={unread} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
