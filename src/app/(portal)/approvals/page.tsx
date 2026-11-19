import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { requireActor } from "@/server/auth/get-actor";
import { myApprovals } from "@/server/services/approvals";
import { DecisionButtons } from "@/components/approvals/approval-ui";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, ColorBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "My Approvals" };

export default async function ApprovalsPage() {
  const actor = await requireActor();
  const { pending, decided } = await myApprovals(actor);
  return (
    <div className="space-y-5">
      <PageHeader title="My Approvals" description="Requests from your team that need your decision." />
      <Card>
        <CardHeader><CardTitle className="text-base">Waiting for you ({pending.length})</CardTitle></CardHeader>
        <CardContent>
          {pending.length === 0 ? <EmptyState icon={<CheckSquare />} title="Nothing to approve" description="You're all caught up." /> : (
            <ul className="divide-y" data-testid="pending-approvals">
              {pending.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-4 py-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/tickets/${a.ticket.number}`} className="font-mono text-sm font-medium text-primary hover:underline">{a.ticket.number}</Link>
                      <ColorBadge color={a.ticket.priority.color}>{a.ticket.priority.code}</ColorBadge>
                      <Badge variant="secondary">{a.stepName}</Badge>
                    </p>
                    <p className="font-medium">{a.ticket.subject}</p>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{a.ticket.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.ticket.requester.displayName}{a.ticket.requester.jobTitle ? `, ${a.ticket.requester.jobTitle}` : ""}{a.ticket.requester.department ? ` · ${a.ticket.requester.department.name}` : ""}
                      {" · "}{a.ticket.category.name}{a.ticket.subcategory ? ` › ${a.ticket.subcategory.name}` : ""} · {formatDateTime(a.ticket.createdAt)}
                    </p>
                  </div>
                  <DecisionButtons approvalId={a.id} ticketNumber={a.ticket.number} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {decided.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Recently decided</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="decided-approvals">
              {decided.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Link href={`/tickets/${a.ticket.number}`} className="font-mono text-primary hover:underline">{a.ticket.number}</Link>
                  <span className="min-w-0 flex-1 truncate">{a.ticket.subject}</span>
                  <Badge variant={a.decision === "APPROVED" ? "success" : "destructive"}>{a.decision === "APPROVED" ? "Approved" : "Rejected"}</Badge>
                  <span className="text-xs text-muted-foreground">{a.decidedAt ? formatDateTime(a.decidedAt) : ""}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
