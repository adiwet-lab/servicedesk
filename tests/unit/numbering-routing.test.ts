import { describe, expect, it } from "vitest";
import { formatNumber, validateNumberFormat } from "@/server/services/numbering";
import { resolveRouting, type RoutingRuleLite } from "@/server/domain/routing";

describe("ticket number format", () => {
  const d = new Date(2026, 4, 3);
  it("default format", () => expect(formatNumber("{PREFIX}-{YYYY}-{SEQ:6}", "IT", d, 1)).toBe("IT-2026-000001"));
  it("other tokens", () => expect(formatNumber("{PREFIX}{YY}{MM}/{SEQ:4}", "HD", d, 42)).toBe("HD2605/0042"));
  it("unpadded seq", () => expect(formatNumber("T-{SEQ}", "X", d, 7)).toBe("T-7"));
  it("does not truncate large sequences", () => expect(formatNumber("{SEQ:3}", "X", d, 12345)).toBe("12345"));
  it("validation", () => {
    expect(validateNumberFormat("{PREFIX}-{YYYY}-{SEQ:6}")).toBeNull();
    expect(validateNumberFormat("{PREFIX}-{YYYY}")).toMatch(/SEQ/);
    expect(validateNumberFormat("{PREFIX}-{FOO}-{SEQ}")).toMatch(/unknown token/);
    expect(validateNumberFormat("<script>{SEQ}")).toMatch(/only contain/);
  });
});

describe("routing resolution", () => {
  const ticket = { categoryId: "HW", subcategoryId: "HW-PR", priorityId: "P2", companyId: "C", departmentId: "D", branchId: "B1" };
  const cat = { id: "HW", defaultTeamId: "IT" };
  const sub = { id: "HW-PR", defaultTeamId: "PRINT" };
  const rule = (o: Partial<RoutingRuleLite>): RoutingRuleLite => ({ id: "r", order: 10, isActive: true, categoryId: null, conditions: {}, targetTeamId: "X", targetAgentId: null, ...o });

  it("subcategory default beats category default", () => {
    expect(resolveRouting({ ticket, category: cat, subcategory: sub, rules: [], fallbackTeamId: "FB" })).toMatchObject({ teamId: "PRINT", source: "subcategory" });
  });
  it("category default when subcategory has none", () => {
    expect(resolveRouting({ ticket, category: cat, subcategory: { id: "HW-PR", defaultTeamId: null }, rules: [], fallbackTeamId: "FB" })).toMatchObject({ teamId: "IT", source: "category" });
  });
  it("fallback team when nothing else", () => {
    expect(resolveRouting({ ticket, category: { id: "HW", defaultTeamId: null }, subcategory: null, rules: [], fallbackTeamId: "FB" })).toMatchObject({ teamId: "FB", source: "fallback" });
  });
  it("matching rule wins, lowest order first", () => {
    const rules = [rule({ id: "late", order: 50, targetTeamId: "LATE" }), rule({ id: "early", order: 5, categoryId: "HW-PR", targetTeamId: "EARLY", targetAgentId: "A1" })];
    expect(resolveRouting({ ticket, category: cat, subcategory: sub, rules, fallbackTeamId: null })).toEqual({ teamId: "EARLY", agentId: "A1", source: "rule", ruleId: "early" });
  });
  it("rule conditions must all match", () => {
    const rules = [rule({ conditions: { branchId: "B2" }, targetTeamId: "B2TEAM" }), rule({ id: "r2", order: 20, conditions: { branchId: ["B1", "B3"], priorityId: "P2" }, targetTeamId: "B1TEAM" })];
    expect(resolveRouting({ ticket, category: cat, subcategory: sub, rules, fallbackTeamId: null }).teamId).toBe("B1TEAM");
  });
  it("inactive rules and other categories are ignored", () => {
    const rules = [rule({ isActive: false, targetTeamId: "NO" }), rule({ categoryId: "NW", targetTeamId: "NO2" })];
    expect(resolveRouting({ ticket, category: cat, subcategory: sub, rules, fallbackTeamId: null }).teamId).toBe("PRINT");
  });
});
