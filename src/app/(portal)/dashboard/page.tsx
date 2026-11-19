import Link from "next/link";
import { redirect } from "next/navigation";
import { PlusCircle } from "lucide-react";
import { requireActor } from "@/server/auth/get-actor";
import { can, canAccessAdminPortal } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { listTickets, ticketSummary, availableViews } from "@/server/services/tickets";
import { ticketListQuerySchema } from "@/lib/validation/ticket";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi";
import { TicketTable } from "@/components/tickets/ticket-table";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requireActor();
  // External/support-only users without a requester role land in the support portal.
  if (!can(actor, P.TICKET_READ_OWN) && canAccessAdminPortal(actor)) redirect("/admin");

  const views = availableViews(actor);
  const summary = await ticketSummary(actor, { requesterId: actor.id });
  const recent = views.has("my") ? await listTickets(actor, "my", ticketListQuerySchema.parse({ pageSize: 10 })) : null;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${actor.displayName.split(" ")[0]}`}
        description="Track your IT requests and incidents."
        actions={can(actor, P.TICKET_CREATE) && <Button asChild><Link href="/tickets/new"><PlusCircle /> Create ticket</Link></Button>}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Total My Tickets" value={summary.total} href="/tickets" color="#3b82f6" />
        {summary.statuses.map((s) => (
          <KpiCard key={s.id} label={s.name} value={s.count} color={s.color} href={`/tickets?status=${s.id}`} />
        ))}
        <KpiCard label="Overdue" value={summary.overdue} tone="danger" color="#ef4444" />
      </div>
      {recent && (
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Recent tickets</CardTitle>
            <Link href="/tickets" className="text-sm text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="p-0">
            <TicketTable rows={recent.rows} total={recent.total} page={1} pages={1} base="/tickets" params={{}} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
