import Link from "next/link";
import { Siren } from "lucide-react";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { getIncidentPanel, IMPACT_LABEL, MI_STATUS_LABEL } from "@/server/services/incidents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { DeclareDialog, ImpactDialog, IncidentUpdateForm, LinkTicketForm, ResolveIncidentDialog, UnlinkButton } from "./incident-forms";

export function MiStatusBadge({ status }: { status: keyof typeof MI_STATUS_LABEL }) {
  const variant = status === "RESOLVED" ? "success" : status === "MONITORING" ? "secondary" : status === "IDENTIFIED" ? "warning" : "destructive";
  return <Badge variant={variant} data-testid="mi-status">{MI_STATUS_LABEL[status]}</Badge>;
}

/** Ticket-page card: impact, major-incident lifecycle, linked tickets. */
export async function IncidentPanel({ actor, ticketId, ticketBase }: { actor: Actor; ticketId: string; ticketBase: string }) {
  const p = await getIncidentPanel(actor, ticketId);
  const branches = p.canSetImpact
    ? await prisma.branch.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];
  const active = p.isMajorIncident && p.majorIncidentStatus !== "RESOLVED";
  // Nothing to show for an ordinary ticket the viewer can't change.
  if (!p.isMajorIncident && !p.parentIncident && !p.impactScope && !p.canSetImpact) return null;

  return (
    <Card className={p.isMajorIncident ? "border-destructive/50" : undefined} data-testid="incident-panel">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {p.isMajorIncident && <Siren className="size-4 text-destructive" />}{p.isMajorIncident ? "Major incident" : "Impact"}
        </CardTitle>
        {p.isMajorIncident && p.majorIncidentStatus && <MiStatusBadge status={p.majorIncidentStatus} />}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {p.parentIncident && (
          <p className="rounded-md bg-muted p-2">Linked to major incident{" "}
            <Link className="font-mono font-medium text-primary hover:underline" href={`${ticketBase}/${p.parentIncident.number}`}>{p.parentIncident.number}</Link> — {p.parentIncident.subject}
            {p.parentIncident.majorIncidentStatus && <> · {MI_STATUS_LABEL[p.parentIncident.majorIncidentStatus]}</>}</p>
        )}
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
          <dt className="text-muted-foreground">Scope</dt><dd data-testid="impact-value">{p.impactScope ? IMPACT_LABEL[p.impactScope] : "—"}</dd>
          <dt className="text-muted-foreground">Branches</dt><dd>{p.impactedBranches.map((b) => b.branch.name).join(", ") || "—"}</dd>
          <dt className="text-muted-foreground">Users</dt><dd>{p.impactedUserCount ? `~${p.impactedUserCount}` : "—"}</dd>
          {p.majorDeclaredAt && <><dt className="text-muted-foreground">Declared</dt><dd>{formatDateTime(p.majorDeclaredAt)} by {p.majorDeclaredBy?.displayName}</dd></>}
        </dl>
        <div className="flex flex-wrap gap-2">
          {p.canSetImpact && <ImpactDialog ticketId={p.id} branches={branches} scope={p.impactScope} branchIds={p.impactedBranches.map((b) => b.branch.id)} userCount={p.impactedUserCount} />}
          {p.canDeclare && <DeclareDialog ticketId={p.id} hasImpact={!!p.impactScope} />}
          {p.isMajorIncident && p.canManage && <ResolveIncidentDialog ticketId={p.id} linkedCount={p._count.childTickets} active={active} />}
        </div>

        {p.isMajorIncident && (
          <>
            {active && p.canManage && <IncidentUpdateForm ticketId={p.id} current={p.majorIncidentStatus ?? "INVESTIGATING"} />}
            <div>
              <p className="mb-2 font-medium">Communication log</p>
              <ol className="space-y-2" data-testid="incident-updates">
                {p.incidentUpdates.map((u) => (
                  <li key={u.id} className="border-l-2 pl-3">
                    <p className="flex flex-wrap items-center gap-2"><MiStatusBadge status={u.status} /><span className="text-xs text-muted-foreground">{u.author.displayName} · {formatDateTime(u.createdAt)}</span></p>
                    <p className="mt-1 whitespace-pre-wrap">{u.message}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="mb-2 font-medium">Linked tickets ({p._count.childTickets})</p>
              <ul className="divide-y" data-testid="linked-tickets">
                {p.childTickets.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-1.5">
                    <Link className="font-mono text-xs text-primary hover:underline" href={`${ticketBase}/${c.number}`}>{c.number}</Link>
                    <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                    <Badge variant="secondary" className="shrink-0">{c.status.name}</Badge>
                    {p.canManage && active && <UnlinkButton childId={c.id} />}
                  </li>
                ))}
                {p._count.childTickets > p.childTickets.length && <li className="py-1.5 text-xs text-muted-foreground">+{p._count.childTickets - p.childTickets.length} outside your access</li>}
              </ul>
              {active && p.canManage && <div className="mt-2"><LinkTicketForm ticketId={p.id} /></div>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
