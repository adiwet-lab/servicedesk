import { describe, expect, it } from "vitest";
import { normaliseCreateImpact, validateImpact } from "@/server/domain/impact";

describe("impact validation", () => {
  it("single branch needs exactly one branch", () => {
    expect(validateImpact({ impactScope: "SINGLE_BRANCH", branchIds: [] })).toMatch(/exactly one/);
    expect(validateImpact({ impactScope: "SINGLE_BRANCH", branchIds: ["a", "b"] })).toMatch(/exactly one/);
    expect(validateImpact({ impactScope: "SINGLE_BRANCH", branchIds: ["a"] })).toBeNull();
  });
  it("multiple branches needs at least two distinct branches", () => {
    expect(validateImpact({ impactScope: "MULTIPLE_BRANCHES", branchIds: ["a", "a"] })).toMatch(/at least two/);
    expect(validateImpact({ impactScope: "MULTIPLE_BRANCHES", branchIds: ["a", "b"] })).toBeNull();
  });
  it("single user allows at most one branch; company-wide allows any", () => {
    expect(validateImpact({ impactScope: "SINGLE_USER", branchIds: ["a", "b"] })).not.toBeNull();
    expect(validateImpact({ impactScope: "SINGLE_USER", branchIds: [] })).toBeNull();
    expect(validateImpact({ impactScope: "COMPANY_WIDE", branchIds: [] })).toBeNull();
    expect(validateImpact({ impactScope: "MULTIPLE_COMPANIES", branchIds: ["a", "b", "c"] })).toBeNull();
  });
  it("create-time impact defaults a single-branch impact to the ticket branch", () => {
    expect(normaliseCreateImpact(undefined, ["x"], "b1")).toBeNull();
    expect(normaliseCreateImpact("SINGLE_BRANCH", [], "b1")).toEqual({ impactScope: "SINGLE_BRANCH", branchIds: ["b1"] });
    expect(normaliseCreateImpact("SINGLE_BRANCH", [], null)).toEqual({ impactScope: "SINGLE_BRANCH", branchIds: [] });
    expect(normaliseCreateImpact("MULTIPLE_BRANCHES", ["a", "a", "b", ""], "b1")).toEqual({ impactScope: "MULTIPLE_BRANCHES", branchIds: ["a", "b"] });
  });
});
