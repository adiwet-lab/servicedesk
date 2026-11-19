import type { Prisma } from "@prisma/client";
import type { Actor } from "./actor";
import { isVendor } from "./actor";
import { PERMISSIONS as P } from "./permissions";

/** A where-clause that never matches anything. */
const MATCH_NOTHING: Prisma.TicketWhereInput = { id: { in: [] } };

/**
 * Data-scope filter for tickets. EVERY ticket read in the system must be ANDed
 * with this clause — it is the core of server-side row-level authorization.
 *
 * A ticket is visible when ANY of these apply:
 *  - ticket.read.all
 *  - ticket.read.own: requester is me; plus my department / branch per ticketVisibility
 *  - ticket.read.team: owner team, supporting team, or a task's team is one of my teams
 *  - I am the assigned agent of the ticket or of one of its tasks
 *
 * Confidential tickets are additionally restricted (unless ticket.confidential.read)
 * to: requester, assigned agent, and members of the owner team.
 *
 * Vendor-tenant users never receive read.own-based dept/branch visibility.
 */
export function ticketScopeWhere(actor: Actor): Prisma.TicketWhereInput {
  const perms = actor.permissions;
  const vendor = isVendor(actor);
  const and: Prisma.TicketWhereInput[] = [{ deletedAt: null }];

  if (!(perms.has(P.TICKET_READ_ALL) && !vendor)) {
    const or: Prisma.TicketWhereInput[] = [];

    if (perms.has(P.TICKET_READ_OWN)) {
      or.push({ requesterId: actor.id });
      if (!vendor) {
        const v = actor.ticketVisibility;
        if ((v === "OWN_DEPT" || v === "OWN_DEPT_BRANCH") && actor.departmentId) {
          or.push({ departmentId: actor.departmentId });
        }
        if ((v === "OWN_BRANCH" || v === "OWN_DEPT_BRANCH") && actor.branchId) {
          or.push({ branchId: actor.branchId });
        }
      }
    }

    const hasSupportRead = perms.has(P.TICKET_READ_TEAM);
    if (hasSupportRead && actor.teamIds.length > 0) {
      const teams = { in: actor.teamIds };
      or.push({ ownerTeamId: teams });
      or.push({ supportingTeams: { some: { teamId: teams } } });
      or.push({ tasks: { some: { teamId: teams } } });
    }
    if (hasSupportRead || perms.has(P.TICKET_UPDATE)) {
      or.push({ assignedAgentId: actor.id });
      or.push({ tasks: { some: { assignedAgentId: actor.id } } });
    }

    if (or.length === 0) return MATCH_NOTHING;
    and.push({ OR: or });
  }

  if (!perms.has(P.TICKET_CONFIDENTIAL_READ) || vendor) {
    const conf: Prisma.TicketWhereInput[] = [
      { isConfidential: false },
      { requesterId: actor.id },
      { assignedAgentId: actor.id },
    ];
    if (perms.has(P.TICKET_READ_TEAM) && actor.teamIds.length > 0) {
      conf.push({ ownerTeamId: { in: actor.teamIds } });
    }
    and.push({ OR: conf });
  }

  return { AND: and };
}

/**
 * Whether the actor may *work* a ticket (update fields / status as support staff).
 * Read access is a prerequisite and must be checked separately via ticketScopeWhere.
 */
export function canWorkTicket(
  actor: Actor,
  ticket: { ownerTeamId: string | null; assignedAgentId: string | null; supportingTeamIds?: string[] },
): boolean {
  if (!actor.permissions.has(P.TICKET_UPDATE)) return false;
  if (actor.permissions.has(P.TICKET_READ_ALL) && !isVendor(actor)) return true;
  if (ticket.assignedAgentId === actor.id) return true;
  if (ticket.ownerTeamId && actor.teamIds.includes(ticket.ownerTeamId)) return true;
  return false;
}

/** Whether the actor may (re)assign the ticket's agent / owner team. */
export function canAssignTicket(actor: Actor, ticket: { ownerTeamId: string | null }): boolean {
  if (isVendor(actor)) return false;
  if (!actor.permissions.has(P.TICKET_ASSIGN)) return false;
  if (actor.permissions.has(P.TICKET_READ_ALL)) return true;
  return !!ticket.ownerTeamId && actor.teamIds.includes(ticket.ownerTeamId);
}

/** Message visibility filter — internal notes never reach users without note.internal.read. */
export function messageScopeWhere(actor: Actor): Prisma.TicketMessageWhereInput {
  if (actor.permissions.has(P.NOTE_INTERNAL_READ) && !isVendor(actor)) return { deletedAt: null };
  return { deletedAt: null, type: "PUBLIC" };
}
