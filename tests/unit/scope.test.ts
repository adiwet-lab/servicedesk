import { describe, expect, it } from "vitest";
import { canAssignTicket, canWorkTicket, messageScopeWhere, ticketScopeWhere, UNCLAIMED_CHAT } from "@/server/authz/scope";
import { makeActor } from "./helpers";

const APPROVER = { approvals: { some: { approverId: "u1", decision: { not: "WAITING" } } } };
/** Flattens the OR branches of the visibility clause (minus the approver branch) for easy assertions. */
/** The confidential clause is the OR that starts with exactly { isConfidential: false }. */
function isConfidentialClause(c: object) {
  return JSON.stringify((c as { OR: object[] }).OR[0]) === JSON.stringify({ isConfidential: false });
}
function orBranches(where: ReturnType<typeof ticketScopeWhere>) {
  const and = (where.AND as object[]) ?? [];
  const vis = and.find((c) => "OR" in c && (c as { OR: object[] }).OR.some((o) => "requesterId" in o || "ownerTeamId" in o || "assignedAgentId" in o || "approvals" in o) && !isConfidentialClause(c)) as { OR: object[] } | undefined;
  return (vis?.OR ?? []).filter((o) => !("approvals" in o));
}
function hasApproverBranch(where: ReturnType<typeof ticketScopeWhere>) {
  return ((where.AND as object[]) ?? []).some((c) => "OR" in c && (c as { OR: object[] }).OR.some((o) => JSON.stringify(o) === JSON.stringify(APPROVER)) && !isConfidentialClause(c));
}
function confidentialClause(where: ReturnType<typeof ticketScopeWhere>) {
  return ((where.AND as object[]) ?? []).find((c) => "OR" in c && (c as { OR: object[] }).OR.some((o) => "isConfidential" in o));
}

describe("ticketScopeWhere — employee visibility modes", () => {
  it("OWN: only own tickets", () => {
    const w = ticketScopeWhere(makeActor("EMPLOYEE"));
    expect(orBranches(w)).toEqual([{ requesterId: "u1" }]);
  });
  it("OWN_DEPT adds department", () => {
    const w = ticketScopeWhere(makeActor("EMPLOYEE", { ticketVisibility: "OWN_DEPT" }));
    expect(orBranches(w)).toEqual([{ requesterId: "u1" }, { departmentId: "d1" }]);
  });
  it("OWN_BRANCH adds branch", () => {
    const w = ticketScopeWhere(makeActor("EMPLOYEE", { ticketVisibility: "OWN_BRANCH" }));
    expect(orBranches(w)).toEqual([{ requesterId: "u1" }, { branchId: "b1" }]);
  });
  it("OWN_DEPT_BRANCH adds both", () => {
    const w = ticketScopeWhere(makeActor("EMPLOYEE", { ticketVisibility: "OWN_DEPT_BRANCH" }));
    expect(orBranches(w)).toEqual([{ requesterId: "u1" }, { departmentId: "d1" }, { branchId: "b1" }]);
  });
  it("OWN_DEPT without a department grants nothing extra", () => {
    const w = ticketScopeWhere(makeActor("EMPLOYEE", { ticketVisibility: "OWN_DEPT", departmentId: null }));
    expect(orBranches(w)).toEqual([{ requesterId: "u1" }]);
  });
  it("employees are always subject to the confidential filter", () => {
    const w = ticketScopeWhere(makeActor("EMPLOYEE", { ticketVisibility: "OWN_DEPT" }));
    expect(confidentialClause(w)).toEqual({ OR: [{ isConfidential: false }, { requesterId: "u1" }, { assignedAgentId: "u1" }, APPROVER] });
  });
  it("always excludes soft-deleted tickets", () => {
    expect((ticketScopeWhere(makeActor("EMPLOYEE")).AND as object[])[0]).toEqual({ deletedAt: null });
  });
});

describe("ticketScopeWhere — support staff", () => {
  it("agent sees own team's owned / supporting / task tickets and own assignments", () => {
    const w = ticketScopeWhere(makeActor("SUPPORT_AGENT", { teamIds: ["T1"] }));
    const or = orBranches(w);
    expect(or).toContainEqual({ ownerTeamId: { in: ["T1"] } });
    expect(or).toContainEqual({ supportingTeams: { some: { teamId: { in: ["T1"] } } } });
    expect(or).toContainEqual({ tasks: { some: { teamId: { in: ["T1"] } } } });
    expect(or).toContainEqual({ assignedAgentId: "u1" });
  });
  it("agent with no team only sees own/assigned", () => {
    const or = orBranches(ticketScopeWhere(makeActor("SUPPORT_AGENT")));
    expect(or.some((o) => "ownerTeamId" in o)).toBe(false);
  });
  it("agent confidential filter includes owner team", () => {
    const w = ticketScopeWhere(makeActor("SUPPORT_AGENT", { teamIds: ["T1"] }));
    expect((confidentialClause(w) as { OR: object[] }).OR).toContainEqual({ ownerTeamId: { in: ["T1"] } });
  });
  it("system admin (read.all + confidential.read) has no restrictions beyond soft-delete", () => {
    expect(ticketScopeWhere(makeActor("SYSTEM_ADMIN"))).toEqual({ AND: [{ deletedAt: null }] });
  });
});

describe("ticketScopeWhere — chat queue (Phase 9)", () => {
  it("internal support staff also see unclaimed chat cases of every team", () => {
    expect(orBranches(ticketScopeWhere(makeActor("SUPPORT_AGENT", { teamIds: ["T1"] })))).toContainEqual(UNCLAIMED_CHAT);
  });
  it("employees and vendor staff do not", () => {
    expect(orBranches(ticketScopeWhere(makeActor("EMPLOYEE")))).not.toContainEqual(UNCLAIMED_CHAT);
    const vendor = makeActor("OUTSOURCE_SUPPORT", { tenantType: "VENDOR", teamIds: ["VA"] });
    (vendor.permissions as Set<string>).add("chat.queue"); // even if a role grants it by mistake
    expect(orBranches(ticketScopeWhere(vendor))).not.toContainEqual(UNCLAIMED_CHAT);
  });
  it("the unclaimed-chat branch never includes confidential or closed tickets", () => {
    expect(UNCLAIMED_CHAT).toMatchObject({ channel: "CHAT", assignedAgentId: null, isConfidential: false, status: { kind: { notIn: ["CLOSED", "CANCELLED"] } } });
  });
});

describe("ticketScopeWhere — outsource / vendor isolation", () => {
  const vendor = makeActor("OUTSOURCE_SUPPORT", { tenantType: "VENDOR", teamIds: ["VA"], ticketVisibility: "OWN_DEPT_BRANCH" });
  it("vendor never gets requester/dept/branch visibility", () => {
    const or = orBranches(ticketScopeWhere(vendor));
    expect(or.some((o) => "departmentId" in o || "branchId" in o || "requesterId" in o)).toBe(false);
    expect(or).toContainEqual({ ownerTeamId: { in: ["VA"] } });
  });
  it("vendor with an admin role still cannot read all or confidential tickets", () => {
    const evil = makeActor("SUPER_ADMIN", { tenantType: "VENDOR", teamIds: ["VA"] });
    expect(evil.permissions.has("ticket.read.all")).toBe(false);
    const w = ticketScopeWhere(evil);
    expect(orBranches(w).length).toBeGreaterThan(0);
    expect(confidentialClause(w)).toBeDefined();
  });
  it("vendor never sees internal notes", () => {
    expect(messageScopeWhere(vendor)).toEqual({ deletedAt: null, type: "PUBLIC" });
  });
  it("an internal actor with no read permissions only sees tickets awaiting their approval", () => {
    const a = makeActor("EMPLOYEE");
    a.permissions = new Set();
    const w = ticketScopeWhere(a);
    expect(orBranches(w)).toEqual([]);
    expect(hasApproverBranch(w)).toBe(true);
  });
  it("a vendor actor with no read permissions matches nothing (vendors are never approvers)", () => {
    const a = makeActor("OUTSOURCE_SUPPORT", { tenantType: "VENDOR" });
    a.permissions = new Set();
    expect(ticketScopeWhere(a)).toEqual({ id: { in: [] } });
  });
  it("approver visibility excludes steps that are not yet due", () => {
    expect(hasApproverBranch(ticketScopeWhere(makeActor("EMPLOYEE")))).toBe(true);
    expect(hasApproverBranch(ticketScopeWhere(makeActor("OUTSOURCE_SUPPORT", { tenantType: "VENDOR", teamIds: ["VA"] })))).toBe(false);
  });
});

describe("work / assign checks", () => {
  it("employee cannot work tickets", () => {
    expect(canWorkTicket(makeActor("EMPLOYEE"), { ownerTeamId: "T1", assignedAgentId: null })).toBe(false);
  });
  it("agent can work own team's ticket but not another team's", () => {
    const a = makeActor("SUPPORT_AGENT", { teamIds: ["T1"] });
    expect(canWorkTicket(a, { ownerTeamId: "T1", assignedAgentId: null })).toBe(true);
    expect(canWorkTicket(a, { ownerTeamId: "T2", assignedAgentId: null })).toBe(false);
    expect(canWorkTicket(a, { ownerTeamId: "T2", assignedAgentId: "u1" })).toBe(true);
  });
  it("vendor cannot assign", () => {
    expect(canAssignTicket(makeActor("OUTSOURCE_SUPPORT", { tenantType: "VENDOR", teamIds: ["VA"] }), { ownerTeamId: "VA" })).toBe(false);
  });
  it("team lead can assign within own team only", () => {
    const l = makeActor("TEAM_LEAD", { teamIds: ["T1"] });
    expect(canAssignTicket(l, { ownerTeamId: "T1" })).toBe(true);
    expect(canAssignTicket(l, { ownerTeamId: "T2" })).toBe(false);
  });
});
