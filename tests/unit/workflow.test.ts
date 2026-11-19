import { describe, expect, it } from "vitest";
import { validateTransition, type StatusLite, type TransitionLite, type TransitionContext } from "@/server/domain/workflow";
import { makeActor } from "./helpers";

const S = (id: string, kind: StatusLite["kind"], requiresReason = false): StatusLite => ({ id, kind, requiresReason, name: id });
const NEW = S("NEW", "NEW"), PROG = S("IN_PROGRESS", "OPEN"), WAIT = S("WAITING_USER", "WAITING", true), RES = S("RESOLVED", "RESOLVED"),
  CLOSED = S("CLOSED", "CLOSED"), HOLD = S("ON_HOLD", "WAITING", true);
const T = (from: StatusLite, to: StatusLite, over: Partial<TransitionLite> = {}): TransitionLite => ({
  fromStatusId: from.id, toStatusId: to.id, requiredPermission: "ticket.update", requesterAllowed: false, requiresComment: false, ...over,
});
const agent = makeActor("SUPPORT_AGENT", { teamIds: ["T1"] });
const emp = makeActor("EMPLOYEE");
const ctx = (over: Partial<TransitionContext>): TransitionContext => ({
  actor: agent, isRequester: false, canWork: true, from: NEW, to: PROG, transition: T(NEW, PROG), resolvedAt: null,
  reopenWindowDays: 7, openRequiredTasks: 0, now: new Date("2026-11-19T10:00:00Z"), ...over,
});

describe("validateTransition", () => {
  it("allows a configured transition for support staff", () => {
    expect(validateTransition(ctx({}), {})).toBeNull();
  });
  it("rejects transitions not in the workflow", () => {
    expect(validateTransition(ctx({ transition: null }), {})).toMatch(/not allowed by the workflow/);
  });
  it("rejects same status", () => {
    expect(validateTransition(ctx({ to: NEW }), {})).toMatch(/already/);
  });
  it("WAITING requires a reason", () => {
    const c = ctx({ from: PROG, to: WAIT, transition: T(PROG, WAIT) });
    expect(validateTransition(c, {})).toMatch(/reason is required/);
    expect(validateTransition(c, { reason: "  " })).toMatch(/reason is required/);
    expect(validateTransition(c, { reason: "Need model number" })).toBeNull();
  });
  it("statuses flagged requiresReason require a reason", () => {
    expect(validateTransition(ctx({ from: PROG, to: HOLD, transition: T(PROG, HOLD) }), {})).toMatch(/reason/);
  });
  it("RESOLVED requires a resolution summary", () => {
    const c = ctx({ from: PROG, to: RES, transition: T(PROG, RES) });
    expect(validateTransition(c, {})).toMatch(/resolution summary/);
    expect(validateTransition(c, { resolutionSummary: "Replaced cable" })).toBeNull();
  });
  it("RESOLVED is blocked while required tasks are open", () => {
    const c = ctx({ from: PROG, to: RES, transition: T(PROG, RES), openRequiredTasks: 2 });
    expect(validateTransition(c, { resolutionSummary: "x" })).toMatch(/2 required task/);
  });
  it("employees cannot do staff-only transitions", () => {
    const c = ctx({ actor: emp, isRequester: true, canWork: false });
    expect(validateTransition(c, {})).toMatch(/not allowed to perform/);
  });
  it("requester may do requester-allowed transitions", () => {
    const c = ctx({ actor: emp, isRequester: true, canWork: false, from: RES, to: CLOSED, transition: T(RES, CLOSED, { requesterAllowed: true }) });
    expect(validateTransition(c, {})).toBeNull();
  });
  it("requester reopen only within the reopen window", () => {
    const base = { actor: emp, isRequester: true, canWork: false, from: RES, to: PROG, transition: T(RES, PROG, { requesterAllowed: true }) };
    expect(validateTransition(ctx({ ...base, resolvedAt: new Date("2026-11-15T10:00:00Z") }), {})).toBeNull();
    expect(validateTransition(ctx({ ...base, resolvedAt: new Date("2026-11-01T10:00:00Z") }), {})).toMatch(/reopen window/);
  });
  it("closed tickets are locked without ticket.closed.edit", () => {
    const c = ctx({ from: CLOSED, to: PROG, transition: T(CLOSED, PROG, { requiredPermission: "ticket.update" }) });
    expect(validateTransition(c, {})).toMatch(/not allowed/);
    const admin = makeActor("SYSTEM_ADMIN");
    expect(validateTransition({ ...c, actor: admin }, {})).toBeNull();
  });
  it("requiresComment transitions need a comment", () => {
    const c = ctx({ transition: T(NEW, PROG, { requiresComment: true }) });
    expect(validateTransition(c, {})).toMatch(/comment is required/);
  });
  it("requires the transition's specific permission", () => {
    const c = ctx({ transition: T(NEW, PROG, { requiredPermission: "ticket.escalate" }) });
    expect(validateTransition(c, {})).toMatch(/not allowed/);
  });
});
