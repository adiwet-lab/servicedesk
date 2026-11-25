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
import { getTranslations } from "next-intl/server";
import { currentLocale } from "@/i18n/server";
import { ln } from "@/lib/localized";
import type { Locale } from "@/i18n/config";

const AGE_KEYS = ["0-1", "2-3", "4-7", "8-14", "15+"] as const;

async function resolveDrillNames(drill: { k: string; v: string }[], locale: Locale): Promise<Record<string, string>> {
  const t = await getTranslations("ticketList");
  const out: Record<string, string> = {};
  const nm = (r: { name: string; nameTh: string | null } | null) => (r ? ln(r, locale) : null);
  for (const { k, v } of drill) {
    if (k === "aging") out[k] = (AGE_KEYS as readonly string[]).includes(v) ? t(`age.${v as (typeof AGE_KEYS)[number]}`) : v;
    else if (k === "agent") out[k] = v === "none" ? t("unassigned") : (await prisma.user.findUnique({ where: { id: v }, select: { displayName: true } }))?.displayName ?? v;
    else if (k === "branch") out[k] = nm(await prisma.branch.findUnique({ where: { id: v }, select: { name: true, nameTh: true } })) ?? v;
    else if (k === "department") out[k] = nm(await prisma.department.findUnique({ where: { id: v }, select: { name: true, nameTh: true } })) ?? v;
    else if (k === "subcategory") out[k] = nm(await prisma.category.findUnique({ where: { id: v }, select: { name: true, nameTh: true } })) ?? v;
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
  const [t, locale] = await Promise.all([getTranslations("ticketList"), currentLocale()]);
  const DRILL = ["from", "to", "aging", "agent", "branch", "department", "subcategory", "company"] as const;
  const drill = DRILL.filter((k) => params[k]).map((k) => ({ k, label: t(`drill.${k}`), v: params[k]! }));
  for (const d of drill) hidden[d.k] = d.v;
  const drillNames = drill.length ? await resolveDrillNames(drill, locale) : {};
  return (
    <div>
      <PageHeader title={title} description={description}
        actions={can(actor, P.TICKET_CREATE) && <Button asChild><Link href="/tickets/new"><PlusCircle /> {t("createTicket")}</Link></Button>} />
      {drill.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="drill-filters">
          <span className="text-muted-foreground">{t("filteredFrom")}</span>
          {drill.map((d) => {
            const rest = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== d.k && k !== "page" && v) as [string, string][]);
            return (
              <Link key={d.k} href={`${base}?${rest}`} className="rounded-full border bg-card px-2.5 py-0.5 hover:bg-accent" title={t("removeFilter")}>
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
