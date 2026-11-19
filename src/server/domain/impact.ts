/** Branch-impact rules (pure, unit-tested). */
export const IMPACT_SCOPES = ["SINGLE_USER", "SINGLE_BRANCH", "MULTIPLE_BRANCHES", "COMPANY_WIDE", "MULTIPLE_COMPANIES"] as const;
export type ImpactScopeCode = (typeof IMPACT_SCOPES)[number];

export const IMPACT_LABEL: Record<ImpactScopeCode, string> = {
  SINGLE_USER: "Single user", SINGLE_BRANCH: "Single branch", MULTIPLE_BRANCHES: "Multiple branches",
  COMPANY_WIDE: "Company-wide", MULTIPLE_COMPANIES: "Multiple companies",
};

/** Returns an error message or null. */
export function validateImpact(i: { impactScope: ImpactScopeCode; branchIds: string[] }): string | null {
  const n = new Set(i.branchIds).size;
  if (i.impactScope === "SINGLE_BRANCH" && n !== 1) return "Select exactly one impacted branch for a single-branch impact.";
  if (i.impactScope === "MULTIPLE_BRANCHES" && n < 2) return "Select at least two impacted branches.";
  if (i.impactScope === "SINGLE_USER" && n > 1) return "A single-user impact can involve at most one branch.";
  return null;
}

/**
 * Normalises impact supplied when a ticket is created: a single-branch impact without
 * an explicit branch defaults to the ticket's branch.
 */
export function normaliseCreateImpact(scope: ImpactScopeCode | undefined, branchIds: string[], ticketBranchId: string | null) {
  if (!scope) return null;
  let ids = [...new Set(branchIds.filter(Boolean))];
  if ((scope === "SINGLE_BRANCH" || scope === "SINGLE_USER") && ids.length === 0 && ticketBranchId) ids = [ticketBranchId];
  if (scope === "COMPANY_WIDE" || scope === "MULTIPLE_COMPANIES") ids = ids.length ? ids : [];
  return { impactScope: scope, branchIds: ids };
}
