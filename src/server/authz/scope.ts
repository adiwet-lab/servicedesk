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
/** Open chat cases without an agent (the shared chat queue). Never confidential. */
export const UNCLAIMED_CHAT: Prisma.TicketWhereInput = {
  channel: "CHAT", assignedAgentId: null, isConfidential: false, status: { kind: { notIn: ["CLOSED", "CANCELLED"] } },
};

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

    // Chat queue (Phase 9): internal staff see every chat case nobody has claimed yet, so the right team can pick it up.
    if (!vendor && perms.has(P.CHAT_QUEUE)) or.push(UNCLAIMED_CHAT);

    // Approvers see the tickets awaiting (or decided by) them.
    if (!vendor) or.push({ approvals: { some: { approverId: actor.id, decision: { not: "WAITING" } } } });

    if (or.length === 0) return MATCH_NOTHING;
    and.push({ OR: or });
  }

  if (!perms.has(P.TICKET_CONFIDENTIAL_READ) || vendor) {
    const conf: Prisma.TicketWhereInput[] = [
      { isConfidential: false },
      { requesterId: actor.id },
      { assignedAgentId: actor.id },
      { approvals: { some: { approverId: actor.id, decision: { not: "WAITING" } } } },
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

// ───────────────────────────── Tasks ─────────────────────────────

/**
 * Task visibility: the parent ticket must be visible. Vendor users are further
 * limited to tasks of their own teams or tasks assigned to them.
 */
export function taskScopeWhere(actor: Actor): Prisma.TicketTaskWhereInput {
  const base: Prisma.TicketTaskWhereInput = { ticket: ticketScopeWhere(actor) };
  if (!isVendor(actor)) return base;
  return { AND: [base, { OR: [{ teamId: { in: actor.teamIds } }, { assignedAgentId: actor.id }] }] };
}

/** Create tasks on a ticket: task.manage + able to work the ticket. */
export function canManageTicketTasks(actor: Actor, ticket: { ownerTeamId: string | null; assignedAgentId: string | null }): boolean {
  return actor.permissions.has(P.TASK_MANAGE) && canWorkTicket(actor, ticket);
}

type TaskLite = { teamId: string | null; assignedAgentId: string | null };
type TicketLite = { ownerTeamId: string | null; assignedAgentId: string | null };

/** Update / change status of a task. */
export function canWorkTask(actor: Actor, task: TaskLite, ticket: TicketLite): boolean {
  if (!actor.permissions.has(P.TASK_MANAGE)) return false;
  if (task.assignedAgentId === actor.id) return true;
  if (task.teamId && actor.teamIds.includes(task.teamId)) return true;
  if (isVendor(actor)) return false;
  return canWorkTicket(actor, ticket);
}

/** Reopen a completed task — owner-team staff / ticket assignee / admins only. */
export function canReopenTask(actor: Actor, ticket: TicketLite): boolean {
  return !isVendor(actor) && actor.permissions.has(P.TASK_MANAGE) && canWorkTicket(actor, ticket);
}

/**
 * Assign / reassign a task to a team/agent.
 *  - task.assign holders who can work the ticket (or lead the task's team) may assign anyone
 *  - otherwise only self-assignment within a team the actor belongs to
 */
export function canAssignTask(
  actor: Actor,
  task: TaskLite,
  ticket: TicketLite,
  target: { teamId: string | null; agentId: string | null },
): boolean {
  if (!actor.permissions.has(P.TASK_MANAGE)) return false;
  const leadsTaskTeam = !!task.teamId && actor.leadTeamIds.includes(task.teamId);
  if (actor.permissions.has(P.TASK_ASSIGN) && !isVendor(actor) && (canWorkTicket(actor, ticket) || leadsTaskTeam)) return true;
  // Self-assignment within own team, team unchanged
  const teamUnchanged = target.teamId === task.teamId;
  return teamUnchanged && target.agentId === actor.id && !!task.teamId && actor.teamIds.includes(task.teamId);
}
