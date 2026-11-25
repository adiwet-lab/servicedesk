import { describe, expect, it } from "vitest";
import { nextAfterApproval, resolveApprovalChain, type StepDef } from "@/server/domain/approvals";
import { validateTransition } from "@/server/domain/workflow";
import { makeActor } from "./helpers";

const users = (...ids: [string, boolean][]) => new Map(ids.map(([id, active]) => [id, { id, active }]));
const mgr: StepDef = { order: 1, name: "Manager approval", approverType: "REQUESTER_MANAGER", approverUserId: null, fallbackUserId: "fb" };
const it2: StepDef = { order: 2, name: "IT approval", approverType: "SPECIFIC_USER", approverUserId: "itlead", fallbackUserId: null };

describe("resolveApprovalChain", () => {
  it("resolves the requester's manager and specific users in order", () => {
    const r = resolveApprovalChain([it2, mgr], { id: "req", managerId: "boss" }, users(["boss", true], ["itlead", true], ["fb", true]));
    expect(r).toEqual({ ok: true, steps: [
      { order: 1, name: "Manager approval", nameTh: null, approverId: "boss", viaFallback: false },
      { order: 2, name: "IT approval", nameTh: null, approverId: "itlead", viaFallback: false },
    ] });
  });
  it("carries the Thai step name", () => {
    const r = resolveApprovalChain([{ ...mgr, nameTh: "อนุมัติโดยหัวหน้า" }], { id: "req", managerId: "boss" }, users(["boss", true]));
    expect(r.ok && r.steps[0]).toMatchObject({ name: "Manager approval", nameTh: "อนุมัติโดยหัวหน้า" });
  });
  it("falls back when the manager is missing, inactive or the requester themself", () => {
    for (const [managerId, list] of [[null, users(["fb", true])], ["boss", users(["boss", false], ["fb", true])], ["req", users(["req", true], ["fb", true])]] as const) {
      const r = resolveApprovalChain([mgr], { id: "req", managerId }, list);
      expect(r.ok && r.steps[0]).toMatchObject({ approverId: "fb", viaFallback: true });
    }
  });
  it("never lets a requester approve their own request, even as the specific approver or fallback", () => {
    const self: StepDef = { order: 1, name: "Self", approverType: "SPECIFIC_USER", approverUserId: "req", fallbackUserId: "req" };
    expect(resolveApprovalChain([self], { id: "req", managerId: null }, users(["req", true]))).toMatchObject({ ok: false });
  });
  it("fails clearly when no approver can be found, and for empty policies", () => {
    expect(resolveApprovalChain([it2], { id: "req", managerId: null }, users(["itlead", false]))).toMatchObject({ ok: false, error: expect.stringContaining("IT approval") });
    expect(resolveApprovalChain([], { id: "req", managerId: null }, users())).toMatchObject({ ok: false });
  });
});

describe("nextAfterApproval", () => {
  it("moves to the next waiting step or completes", () => {
    const rows = [{ stepOrder: 1, decision: "APPROVED" }, { stepOrder: 2, decision: "WAITING" }, { stepOrder: 3, decision: "WAITING" }];
    expect(nextAfterApproval(rows, 1)).toEqual({ done: false, nextOrder: 2 });
    expect(nextAfterApproval([{ stepOrder: 1, decision: "APPROVED" }], 1)).toEqual({ done: true });
  });
});

describe("approval gate in the workflow", () => {
  const s = (id: string, kind: "NEW" | "OPEN" | "CANCELLED") => ({ id, kind, name: id, requiresReason: false });
  const base = {
    actor: makeActor("SUPPORT_AGENT", { teamIds: ["T1"] }), isRequester: false, canWork: true, from: s("new", "NEW"),
    resolvedAt: null, reopenWindowDays: 7, openRequiredTasks: 0, approvalPending: true,
  };
  const tr = (to: string) => ({ fromStatusId: "new", toStatusId: to, requiredPermission: "ticket.update", requesterAllowed: false, requiresComment: false });
  it("blocks progress while approval is pending", () => {
    expect(validateTransition({ ...base, to: s("prog", "OPEN"), transition: tr("prog") }, {})).toMatch(/waiting for approval/);
  });
  it("still allows cancellation", () => {
    expect(validateTransition({ ...base, to: s("cancel", "CANCELLED"), transition: tr("cancel") }, {})).toBeNull();
  });
  it("allows progress once approved", () => {
    expect(validateTransition({ ...base, approvalPending: false, to: s("prog", "OPEN"), transition: tr("prog") }, {})).toBeNull();
  });
});
