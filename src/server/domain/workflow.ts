import type { StatusKind } from "@prisma/client";
import type { Actor } from "@/server/authz/actor";
import { PERMISSIONS as P, type PermissionCode } from "@/server/authz/permissions";

export interface StatusLite {
  id: string;
  kind: StatusKind;
  requiresReason: boolean;
  name: string;
}

export interface TransitionLite {
  fromStatusId: string;
  toStatusId: string;
  requiredPermission: string;
  requesterAllowed: boolean;
  requiresComment: boolean;
}

export interface TransitionContext {
  actor: Pick<Actor, "id" | "permissions">;
  /** Actor is the ticket requester. */
  isRequester: boolean;
  /** Actor may work this ticket as support staff (see canWorkTicket). */
  canWork: boolean;
  from: StatusLite;
  to: StatusLite;
  transition: TransitionLite | null;
  resolvedAt: Date | null;
  reopenWindowDays: number;
  openRequiredTasks: number;
  /** Approval is pending: only cancellation is possible. */
  approvalPending?: boolean;
  now?: Date;
}

export interface TransitionInput {
  reason?: string | null;
  resolutionSummary?: string | null;
}

export const TERMINAL_KINDS: StatusKind[] = ["CLOSED", "CANCELLED"];
export const ACTIVE_KINDS: StatusKind[] = ["NEW", "OPEN", "WAITING"];

/** Whether the actor is *permitted* to use this transition (ignores input validation). */
export function isTransitionAllowed(ctx: Omit<TransitionContext, "to"> & { to: StatusLite }): boolean {
  const { transition, actor, from } = ctx;
  if (!transition) return false;
  if (ctx.approvalPending && ctx.to.kind !== "CANCELLED") return false;
  if (from.kind === "CLOSED" && !actor.permissions.has(P.TICKET_CLOSED_EDIT)) return false;
  if (from.kind === "CANCELLED" && !actor.permissions.has(P.TICKET_CLOSED_EDIT)) return false;

  const staffOk = ctx.canWork && actor.permissions.has(transition.requiredPermission as PermissionCode);
  const requesterOk = ctx.isRequester && transition.requesterAllowed && requesterWindowOk(ctx);
  return staffOk || requesterOk;
}

function requesterWindowOk(ctx: TransitionContext): boolean {
  // Requester re-opening a resolved ticket is limited by the reopen window.
  if (ctx.from.kind === "RESOLVED" && ctx.to.kind !== "CLOSED") {
    if (!ctx.resolvedAt) return true;
    const ms = ctx.reopenWindowDays * 24 * 60 * 60 * 1000;
    return (ctx.now ?? new Date()).getTime() - ctx.resolvedAt.getTime() <= ms;
  }
  return true;
}

/** Full validation. Returns an error message or null when the transition may proceed. */
export function validateTransition(ctx: TransitionContext, input: TransitionInput): string | null {
  if (ctx.from.id === ctx.to.id) return "The ticket is already in that status.";
  if (!ctx.transition) return `Transition from "${ctx.from.name}" to "${ctx.to.name}" is not allowed by the workflow.`;
  if (ctx.approvalPending && ctx.to.kind !== "CANCELLED") return "This ticket is waiting for approval. Until it is approved it can only be cancelled.";
  if (!isTransitionAllowed(ctx)) {
    if (ctx.isRequester && ctx.from.kind === "RESOLVED" && ctx.transition.requesterAllowed) {
      return `The reopen window of ${ctx.reopenWindowDays} day(s) has passed. Please create a new ticket.`;
    }
    return "You are not allowed to perform this status change.";
  }
  const reason = input.reason?.trim();
  if ((ctx.to.kind === "WAITING" || ctx.to.requiresReason) && !reason) {
    return `A reason is required for "${ctx.to.name}".`;
  }
  if (ctx.transition.requiresComment && !reason) return "A comment is required for this status change.";
  if (ctx.to.kind === "RESOLVED") {
    if (!input.resolutionSummary?.trim()) return "A resolution summary is required to resolve the ticket.";
    if (ctx.openRequiredTasks > 0) {
      return `Cannot resolve: ${ctx.openRequiredTasks} required task(s) are not completed.`;
    }
  }
  return null;
}
