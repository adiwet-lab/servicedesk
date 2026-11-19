import Link from "next/link";
import { notFound } from "next/navigation";
import { PlusCircle } from "lucide-react";
import type { Actor } from "@/server/authz/actor";
import { can } from "@/server/authz/guards";
import { isVendor } from "@/server/authz/actor";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { availableViews, listTickets, type TicketView } from "@/server/services/tickets";
import { unreadCounts } from "@/server/services/messages";
import { ticketListQuerySchema } from "@/lib/validation/ticket";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { TicketFilters } from "./ticket-filters";
import { TicketTable } from "./ticket-table";

export async function TicketListPage({ actor, view, title, description, base, params, admin = false }: {
  actor: Actor; view: TicketView; title: string; description?: string; base: string; params: Record<string, string | undefined>; admin?: boolean;
}) {
  if (!availableViews(actor).has(view)) notFound();
  const q = ticketListQuerySchema.parse(params);
  const result = await listTickets(actor, view, q);
  const unread = await unreadCounts(actor, result.rows.map((r) => r.id));
  const hidden: Record<string, string> = admin ? { view } : {};
  return (
    <div>
      <PageHeader title={title} description={description}
        actions={can(actor, P.TICKET_CREATE) && <Button asChild><Link href="/tickets/new"><PlusCircle /> Create ticket</Link></Button>} />
      <Card className="overflow-hidden">
        <TicketFilters base={base} params={params} extra={admin} hidden={hidden}
          teamIds={can(actor, P.TICKET_READ_ALL) && !isVendor(actor) ? undefined : actor.teamIds} />
        <TicketTable rows={result.rows} total={result.total} page={result.page} pages={result.pages} base={base}
          params={{ ...params, ...hidden }} detailBase={admin ? "/admin/tickets" : "/tickets"} unread={unread} />
      </Card>
    </div>
  );
}
