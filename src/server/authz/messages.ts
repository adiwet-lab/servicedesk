import type { Actor } from "./actor";
import { isVendor } from "./actor";
import { PERMISSIONS as P } from "./permissions";
import { canWorkTask, canWorkTicket } from "./scope";

export interface ChatTicketContext {
  requesterId: string;
  ownerTeamId: string | null;
  assignedAgentId: string | null;
  statusKind: string;
  /** Tasks the actor can see on the ticket (for task-team participation). */
  tasks: { teamId: string | null; assignedAgentId: string | null }[];
}

function locked(actor: Actor, ctx: ChatTicketContext) {
  return (ctx.statusKind === "CLOSED" || ctx.statusKind === "CANCELLED") && !actor.permissions.has(P.TICKET_CLOSED_EDIT);
}

/** Internal notes are readable only by internal staff holding note.internal.read. */
export function canReadInternalNotes(actor: Actor): boolean {
  return !isVendor(actor) && actor.permissions.has(P.NOTE_INTERNAL_READ);
}

/** Participants: requester, staff who can work the ticket, task team members / assignees. Observers (dept/branch scope) are read-only. */
export function canPostPublicMessage(actor: Actor, ctx: ChatTicketContext): boolean {
  if (locked(actor, ctx)) return false;
  if (ctx.requesterId === actor.id) return true;
  if (canWorkTicket(actor, ctx)) return true;
  return ctx.tasks.some((t) => canWorkTask(actor, t, ctx));
}

export function canPostInternalNote(actor: Actor, ctx: ChatTicketContext): boolean {
  if (locked(actor, ctx)) return false;
  return !isVendor(actor) && actor.permissions.has(P.NOTE_INTERNAL_WRITE) && canReadInternalNotes(actor);
}
