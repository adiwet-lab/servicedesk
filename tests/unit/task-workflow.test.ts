import { describe, expect, it } from "vitest";
import { allowedTaskTransitions, isTaskOverdue, ticketTaskProgress, validateTaskTransition } from "@/server/domain/task-workflow";
import { canAssignTask, canManageTicketTasks, canReopenTask, canWorkTask, taskScopeWhere, ticketScopeWhere } from "@/server/authz/scope";
import { makeActor } from "./helpers";

describe("task transitions", () => {
  it("follows the task lifecycle", () => {
    expect(validateTaskTransition("OPEN", "IN_PROGRESS", { canReopen: false })).toBeNull();
    expect(validateTaskTransition("ASSIGNED", "IN_PROGRESS", { canReopen: false })).toBeNull();
    expect(validateTaskTransition("IN_PROGRESS", "COMPLETED", { canReopen: false })).toBeNull();
    expect(validateTaskTransition("OPEN", "COMPLETED", { canReopen: false })).toMatch(/cannot move/);
    expect(validateTaskTransition("CANCELLED", "OPEN", { canReopen: true })).toMatch(/cannot move/);
    expect(validateTaskTransition("OPEN", "OPEN", { canReopen: true })).toMatch(/already/);
  });
  it("waiting and cancelling require a reason", () => {
    expect(validateTaskTransition("IN_PROGRESS", "WAITING", { canReopen: false })).toMatch(/reason is required/);
    expect(validateTaskTransition("IN_PROGRESS", "WAITING", { canReopen: false, reason: "Vendor parts" })).toBeNull();
    expect(validateTaskTransition("OPEN", "CANCELLED", { canReopen: false, reason: " " })).toMatch(/reason/);
  });
  it("only the owner side can reopen completed tasks", () => {
    expect(validateTaskTransition("COMPLETED", "IN_PROGRESS", { canReopen: false })).toMatch(/owning team/);
    expect(validateTaskTransition("COMPLETED", "IN_PROGRESS", { canReopen: true })).toBeNull();
    expect(allowedTaskTransitions("COMPLETED", { canReopen: false })).toEqual([]);
    expect(allowedTaskTransitions("COMPLETED", { canReopen: true })).toEqual(["IN_PROGRESS"]);
  });
  it("overdue detection ignores done tasks and tasks without due date", () => {
    const now = new Date("2026-11-19T10:00:00Z"), past = new Date("2026-11-18T10:00:00Z");
    expect(isTaskOverdue({ dueDate: past, status: "IN_PROGRESS" }, now)).toBe(true);
    expect(isTaskOverdue({ dueDate: past, status: "COMPLETED" }, now)).toBe(false);
    expect(isTaskOverdue({ dueDate: past, status: "CANCELLED" }, now)).toBe(false);
    expect(isTaskOverdue({ dueDate: null, status: "OPEN" }, now)).toBe(false);
  });
  it("progress excludes cancelled tasks and tracks open required tasks", () => {
    const p = ticketTaskProgress([
      { isRequired: true, status: "COMPLETED" }, { isRequired: true, status: "IN_PROGRESS" },
      { isRequired: false, status: "OPEN" }, { isRequired: true, status: "CANCELLED" },
    ]);
    expect(p).toMatchObject({ total: 3, completed: 1, required: 2, requiredCompleted: 1, openRequired: 1, optional: 1, cancelled: 1, percent: 33 });
    expect(ticketTaskProgress([]).percent).toBe(0);
  });
});

describe("task authorization", () => {
  const ticket = { ownerTeamId: "IT", assignedAgentId: "agentX" };
  const lead = makeActor("TEAM_LEAD", { id: "lead", teamIds: ["IT"], leadTeamIds: ["IT"] });
  const infraAgent = makeActor("SUPPORT_AGENT", { id: "infra1", teamIds: ["INFRA"] });
  const vendor = makeActor("OUTSOURCE_SUPPORT", { id: "v1", tenantType: "VENDOR", teamIds: ["VB"] });
  const employee = makeActor("EMPLOYEE", { id: "emp" });

  it("only staff who can work the ticket create tasks", () => {
    expect(canManageTicketTasks(lead, ticket)).toBe(true);
    expect(canManageTicketTasks(infraAgent, ticket)).toBe(false);
    expect(canManageTicketTasks(employee, { ...ticket, assignedAgentId: "emp" })).toBe(false);
  });
  it("task team members and assignees can work a task; employees cannot", () => {
    const task = { teamId: "INFRA", assignedAgentId: null };
    expect(canWorkTask(infraAgent, task, ticket)).toBe(true);
    expect(canWorkTask(lead, task, ticket)).toBe(true); // owner side
    expect(canWorkTask(vendor, task, ticket)).toBe(false);
    expect(canWorkTask(vendor, { teamId: "VB", assignedAgentId: null }, ticket)).toBe(true);
    expect(canWorkTask(employee, task, ticket)).toBe(false);
  });
  it("vendors and other teams cannot reopen", () => {
    expect(canReopenTask(vendor, ticket)).toBe(false);
    expect(canReopenTask(infraAgent, ticket)).toBe(false);
    expect(canReopenTask(lead, ticket)).toBe(true);
  });
  it("agents may only self-assign within their team; leads may assign", () => {
    const task = { teamId: "INFRA", assignedAgentId: null };
    expect(canAssignTask(infraAgent, task, ticket, { teamId: "INFRA", agentId: "infra1" })).toBe(true);
    expect(canAssignTask(infraAgent, task, ticket, { teamId: "INFRA", agentId: "someoneElse" })).toBe(false);
    expect(canAssignTask(infraAgent, task, ticket, { teamId: "IT", agentId: "infra1" })).toBe(false);
    expect(canAssignTask(lead, task, ticket, { teamId: "ERP", agentId: "x" })).toBe(true);
    const infraLead = makeActor("TEAM_LEAD", { id: "il", teamIds: ["INFRA"], leadTeamIds: ["INFRA"] });
    expect(canAssignTask(infraLead, task, ticket, { teamId: "INFRA", agentId: "infra1" })).toBe(true);
    expect(canAssignTask(vendor, { teamId: "VB", assignedAgentId: null }, ticket, { teamId: "VB", agentId: "v1" })).toBe(true);
    expect(canAssignTask(vendor, { teamId: "VB", assignedAgentId: null }, ticket, { teamId: "VB", agentId: "v2" })).toBe(false);
  });
  it("vendor task scope adds a team/assignee restriction on top of ticket scope", () => {
    expect(taskScopeWhere(lead)).toEqual({ ticket: ticketScopeWhere(lead) });
    expect(taskScopeWhere(vendor)).toEqual({
      AND: [{ ticket: ticketScopeWhere(vendor) }, { OR: [{ teamId: { in: ["VB"] } }, { assignedAgentId: "v1" }] }],
    });
  });
});
