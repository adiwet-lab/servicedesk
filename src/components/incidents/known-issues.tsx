import Link from "next/link";
import { Siren } from "lucide-react";
import type { Actor } from "@/server/authz/actor";
import { activeIncidentsFor, MI_STATUS_LABEL } from "@/server/services/incidents";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { formatDateTime } from "@/lib/utils";
import { AffectedButton } from "./incident-forms";

/** Employee portal banner: active major incidents affecting the user's branch or company. */
export async function KnownIssuesBanner({ actor }: { actor: Actor }) {
  const items = await activeIncidentsFor(actor);
  if (!items.length) return null;
  return (
    <section aria-label="Known issues" className="space-y-2" data-testid="known-issues">
      {items.map((i) => (
        <div key={i.id} className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex flex-wrap items-start gap-3">
            <Siren className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold">Known issue: {i.subject} <span className="ml-1 text-xs font-normal text-muted-foreground">({MI_STATUS_LABEL[i.status]})</span></p>
              {i.latest && <p className="text-sm">{i.latest.message} <span className="text-xs text-muted-foreground">— {formatDateTime(i.latest.createdAt)}</span></p>}
              <p className="text-xs text-muted-foreground">IT is already working on this. You don&apos;t need to open a separate ticket.</p>
            </div>
            {i.myTicket
              ? <Link href={`/tickets/${i.myTicket}`} className="text-sm font-medium text-primary hover:underline">Your report: {i.myTicket}</Link>
              : can(actor, P.TICKET_CREATE) && <AffectedButton incidentId={i.id} />}
          </div>
        </div>
      ))}
    </section>
  );
}
