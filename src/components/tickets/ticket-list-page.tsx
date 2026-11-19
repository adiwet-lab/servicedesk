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
import { prisma } from "@/server/db";

const AGE_LABEL: Record<string, string> = { "0-1": "0–1 day", "2-3": "2–3 days", "4-7": "4–7 days", "8-14": "8–14 days", "15+": "> 14 days" };

async function resolveDrillNames(drill: { k: string; v: string }[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const { k, v } of drill) {
    if (k === "aging") out[k] = AGE_LABEL[v] ?? v;
    else if (k === "agent") out[k] = v === "none" ? "Unassigned" : (await prisma.user.findUnique({ where: { id: v }, select: { displayName: true } }))?.displayName ?? v;
    else if (k === "branch") out[k] = (await prisma.branch.findUnique({ where: { id: v }, select: { name: true } }))?.name ?? v;
    else if (k === "department") out[k] = (await prisma.department.findUnique({ where: { id: v }, select: { name: true } }))?.name ?? v;
    else if (k === "subcategory") out[k] = (await prisma.category.findUnique({ where: { id: v }, select: { name: true } }))?.name ?? v;
    else if (k === "company") out[k] = (await prisma.company.findUnique({ where: { id: v }, select: { name: true } }))?.name ?? v;
  }
  return out;
}

export async function TicketListPage({ actor, view, title, description, base, params, admin = false }: {
  actor: Actor; view: TicketView; title: string; description?: string; base: string; params: Record<string, string | undefined>; admin?: boolean;
}) {
  if (!availableViews(actor).has(view)) notFound();
  const q = ticketListQuerySchema.parse(params);
  const result = await listTickets(actor, view, q);
  const unread = await unreadCounts(actor, result.rows.map((r) => r.id));
  const hidden: Record<string, string> = admin ? { view } : {};
  // Dashboard drill-down parameters are kept across filter changes and shown as removable chips.
  const DRILL: Record<string, string> = { from: "Created from", to: "Created to", aging: "Age", agent: "Agent", branch: "Branch", department: "Department", subcategory: "Subcategory", company: "Company" };
  const drill = Object.entries(DRILL).filter(([k]) => params[k]).map(([k, label]) => ({ k, label, v: params[k]! }));
  for (const d of drill) hidden[d.k] = d.v;
  const drillNames = drill.length ? await resolveDrillNames(drill) : {};
  return (
    <div>
      <PageHeader title={title} description={description}
        actions={can(actor, P.TICKET_CREATE) && <Button asChild><Link href="/tickets/new"><PlusCircle /> Create ticket</Link></Button>} />
      {drill.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="drill-filters">
          <span className="text-muted-foreground">Filtered from dashboard:</span>
          {drill.map((d) => {
            const rest = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== d.k && k !== "page" && v) as [string, string][]);
            return (
              <Link key={d.k} href={`${base}?${rest}`} className="rounded-full border bg-card px-2.5 py-0.5 hover:bg-accent" title="Remove filter">
                {d.label}: <span className="font-medium">{drillNames[d.k] ?? d.v}</span> ×
              </Link>
            );
          })}
        </div>
      )}
      <Card className="overflow-hidden">
        <TicketFilters base={base} params={params} extra={admin} hidden={hidden}
          teamIds={can(actor, P.TICKET_READ_ALL) && !isVendor(actor) ? undefined : actor.teamIds} />
        <TicketTable rows={result.rows} total={result.total} page={result.page} pages={result.pages} base={base}
          params={{ ...params, ...hidden }} detailBase={admin ? "/admin/tickets" : "/tickets"} unread={unread} />
      </Card>
    </div>
  );
}
