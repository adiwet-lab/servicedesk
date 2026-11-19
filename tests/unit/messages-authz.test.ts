import { describe, expect, it } from "vitest";
import { canPostInternalNote, canPostPublicMessage, canReadInternalNotes, type ChatTicketContext } from "@/server/authz/messages";
import { messageScopeWhere } from "@/server/authz/scope";
import { makeActor } from "./helpers";

const ctx = (over: Partial<ChatTicketContext> = {}): ChatTicketContext => ({
  requesterId: "req", ownerTeamId: "IT", assignedAgentId: "agent", statusKind: "OPEN", tasks: [], ...over,
});
const requester = makeActor("EMPLOYEE", { id: "req" });
const colleague = makeActor("EMPLOYEE", { id: "col", ticketVisibility: "OWN_DEPT" });
const agent = makeActor("SUPPORT_AGENT", { id: "agent", teamIds: ["IT"] });
const otherTeamAgent = makeActor("SUPPORT_AGENT", { id: "infra", teamIds: ["INFRA"] });
const vendor = makeActor("OUTSOURCE_SUPPORT", { id: "v", tenantType: "VENDOR", teamIds: ["VB"] });
const admin = makeActor("SYSTEM_ADMIN", { id: "adm" });

describe("public messages", () => {
  it("requester and working staff can post", () => {
    expect(canPostPublicMessage(requester, ctx())).toBe(true);
    expect(canPostPublicMessage(agent, ctx())).toBe(true);
    expect(canPostPublicMessage(admin, ctx())).toBe(true);
  });
  it("department/branch observers are read-only", () => {
    expect(canPostPublicMessage(colleague, ctx())).toBe(false);
  });
  it("task-team members can post; unrelated staff cannot", () => {
    expect(canPostPublicMessage(otherTeamAgent, ctx())).toBe(false);
    expect(canPostPublicMessage(otherTeamAgent, ctx({ tasks: [{ teamId: "INFRA", assignedAgentId: null }] }))).toBe(true);
    expect(canPostPublicMessage(vendor, ctx({ tasks: [{ teamId: "VB", assignedAgentId: null }] }))).toBe(true);
  });
  it("closed tickets are read-only except ticket.closed.edit", () => {
    expect(canPostPublicMessage(requester, ctx({ statusKind: "CLOSED" }))).toBe(false);
    expect(canPostPublicMessage(agent, ctx({ statusKind: "CANCELLED" }))).toBe(false);
    expect(canPostPublicMessage(admin, ctx({ statusKind: "CLOSED" }))).toBe(true);
  });
});

describe("internal notes", () => {
  it("only internal staff with note permissions", () => {
    expect(canReadInternalNotes(agent)).toBe(true);
    expect(canPostInternalNote(agent, ctx())).toBe(true);
    expect(canReadInternalNotes(requester)).toBe(false);
    expect(canPostInternalNote(requester, ctx())).toBe(false);
  });
  it("vendors never read or write internal notes, even with an admin role", () => {
    expect(canReadInternalNotes(vendor)).toBe(false);
    expect(canPostInternalNote(vendor, ctx({ tasks: [{ teamId: "VB", assignedAgentId: "v" }] }))).toBe(false);
    const vendorAdmin = makeActor("SUPER_ADMIN", { tenantType: "VENDOR" });
    expect(canReadInternalNotes(vendorAdmin)).toBe(false);
    expect(messageScopeWhere(vendorAdmin)).toEqual({ deletedAt: null, type: "PUBLIC" });
  });
  it("message scope hides internal notes from requesters", () => {
    expect(messageScopeWhere(requester)).toEqual({ deletedAt: null, type: "PUBLIC" });
    expect(messageScopeWhere(agent)).toEqual({ deletedAt: null });
  });
});
