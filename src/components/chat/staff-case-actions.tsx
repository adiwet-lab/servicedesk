import { getTranslations } from "next-intl/server";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { prisma } from "@/server/db";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getTicketDetail } from "@/server/services/tickets";
import { getTicketEditOptions } from "@/server/services/ticket-updates";
import { currentLocale } from "@/i18n/server";
import { ln } from "@/lib/localized";
import { AssignDialog, StatusChanger } from "@/components/tickets/ticket-actions";
import { EditTicketDialog } from "@/components/tickets/ticket-extra";
import { ClaimChatButton } from "./chat-console";

/**
 * Staff toolbar above a chat conversation: claim (shared queue), change status (workflow rules),
 * change category / fields, assign or transfer (incl. vendor / outsource teams).
 */
export async function StaffCaseActions({ actor, ticket }: { actor: Actor; ticket: string }) {
  const [t, locale] = await Promise.all([getTranslations("chatConsole"), currentLocale()]);
  const detail = await getTicketDetail(actor, ticket);
  const { ticket: tk, permissions: perm, blockingTasks } = detail;
  const closed = ["CLOSED", "CANCELLED"].includes(tk.status.kind);
  const unclaimed = tk.channel === "CHAT" && !tk.assignedAgentId && !closed;
  const canClaim = unclaimed && !isVendor(actor) && actor.permissions.has(P.CHAT_QUEUE);
  const myTeams = canClaim
    ? (await prisma.supportTeam.findMany({ where: { id: { in: actor.teamIds }, isActive: true, deletedAt: null }, select: { id: true, name: true, nameTh: true }, orderBy: { name: "asc" } }))
      .map((x) => ({ id: x.id, name: ln(x, locale) }))
    : [];
  const transitions = detail.allowedTransitions.map((tr) => ({ ...tr, name: ln(tr, locale) }));
  const editOptions = perm.canEdit ? await getTicketEditOptions(locale) : null;
  const [teams, agents] = perm.canAssign && !closed
    ? await Promise.all([
        prisma.supportTeam.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true, nameTh: true }, orderBy: { name: "asc" } })
          .then((rows) => rows.map((r) => ({ id: r.id, name: ln(r, locale) }))),
        tk.ownerTeamId
          ? prisma.user.findMany({ where: { status: "ACTIVE", deletedAt: null, teamMemberships: { some: { teamId: tk.ownerTeamId } } }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } })
          : Promise.resolve([]),
      ])
    : [[], []];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2" data-testid="staff-case-actions">
      {canClaim && <ClaimChatButton ticketId={tk.id} teams={myTeams} preferredTeamId={tk.ownerTeamId && actor.teamIds.includes(tk.ownerTeamId) ? tk.ownerTeamId : null} />}
      {unclaimed && !canClaim && <span className="text-xs text-muted-foreground">{t("unclaimedHint")}</span>}
      <div className="ml-auto flex flex-wrap gap-2">
        {perm.canAssign && !closed && (
          <AssignDialog ticketId={tk.id} teams={teams} currentTeamId={tk.ownerTeamId} currentAgentId={tk.assignedAgentId} canTransfer={perm.canTransfer} initialAgents={agents} />
        )}
        {perm.canEdit && editOptions && <EditTicketDialog ticket={tk} options={editOptions} />}
        <StatusChanger ticketId={tk.id} transitions={transitions} blockingTasks={blockingTasks} />
      </div>
    </div>
  );
}
