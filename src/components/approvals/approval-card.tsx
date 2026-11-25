import { CheckCircle2, Clock, XCircle, MinusCircle } from "lucide-react";
import type { Actor } from "@/server/authz/actor";
import { ticketApprovals } from "@/server/services/approvals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "next-intl/server";
import { currentLocale, getFormat } from "@/i18n/server";
import { pickLang } from "@/lib/localized";
import { DecisionButtons } from "./approval-ui";

const ICON = { APPROVED: CheckCircle2, REJECTED: XCircle, PENDING: Clock, WAITING: Clock, CANCELLED: MinusCircle } as const;

/** Approval chain on the ticket page; the current approver can decide inline. */
export async function ApprovalCard({ actor, ticketId, ticketNumber, status }: { actor: Actor; ticketId: string; ticketNumber: string; status: string }) {
  if (status === "NOT_REQUIRED") return null;
  const rows = await ticketApprovals(actor, ticketId);
  if (!rows.length) return null;
  const [ta, f, locale] = await Promise.all([getTranslations("approvals"), getFormat(), currentLocale()]);
  return (
    <Card data-testid="approval-card">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{ta("cardTitle")}</CardTitle>
        <Badge variant={status === "APPROVED" ? "success" : status === "REJECTED" ? "destructive" : "warning"} data-testid="approval-status">
          {status === "PENDING" ? ta("statusPending") : status === "APPROVED" ? ta("statusApproved") : ta("statusRejected")}
        </Badge>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3 text-sm">
          {rows.map((r) => {
            const Icon = ICON[r.decision];
            return (
              <li key={r.id} className="flex gap-2">
                <Icon className={r.decision === "APPROVED" ? "mt-0.5 size-4 text-success" : r.decision === "REJECTED" ? "mt-0.5 size-4 text-destructive" : "mt-0.5 size-4 text-muted-foreground"} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p><span className="font-medium">{pickLang(r.stepName, r.stepNameTh, locale)}</span> · {r.approver.displayName}</p>
                  <p className="text-xs text-muted-foreground">{ta(`decision.${r.decision}`)}{r.decidedAt ? ` · ${f.dateTime(r.decidedAt)}` : ""}</p>
                  {r.comment && <p className="text-xs">“{r.comment}”</p>}
                  {r.canDecide && <DecisionButtons approvalId={r.id} ticketNumber={ticketNumber} />}
                </div>
              </li>
            );
          })}
        </ol>
        {status === "PENDING" && <p className="mt-3 text-xs text-muted-foreground">{ta("slaPausedHint")}</p>}
      </CardContent>
    </Card>
  );
}
