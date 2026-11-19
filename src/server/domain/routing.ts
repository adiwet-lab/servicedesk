export interface RoutingCategory {
  id: string;
  defaultTeamId: string | null;
  defaultAgentId?: null;
}

export interface RoutingRuleLite {
  id: string;
  order: number;
  isActive: boolean;
  categoryId: string | null;
  conditions: unknown;
  targetTeamId: string;
  targetAgentId: string | null;
}

export interface RoutingTicket {
  categoryId: string;
  subcategoryId: string | null;
  priorityId: string;
  companyId: string | null;
  departmentId: string | null;
  branchId: string | null;
}

export type RoutingResult = {
  teamId: string | null;
  agentId: string | null;
  source: "rule" | "subcategory" | "category" | "fallback" | "none";
  ruleId?: string;
};

const CONDITION_KEYS = ["priorityId", "companyId", "departmentId", "branchId"] as const;

function ruleMatches(rule: RoutingRuleLite, t: RoutingTicket): boolean {
  if (!rule.isActive) return false;
  if (rule.categoryId && rule.categoryId !== t.categoryId && rule.categoryId !== t.subcategoryId) return false;
  const c = (rule.conditions && typeof rule.conditions === "object" ? rule.conditions : {}) as Record<string, unknown>;
  for (const key of CONDITION_KEYS) {
    const want = c[key];
    if (want === undefined || want === null || want === "") continue;
    const values = Array.isArray(want) ? want : [want];
    if (!values.includes(t[key])) return false;
  }
  return true;
}

/**
 * Routing precedence (first hit wins):
 *   1. Active routing rules ordered by `order` (explicit admin overrides with conditions)
 *   2. Subcategory default team
 *   3. Main category default team
 *   4. Global fallback team (system setting)
 */
export function resolveRouting(args: {
  ticket: RoutingTicket;
  category: RoutingCategory;
  subcategory: RoutingCategory | null;
  rules: RoutingRuleLite[];
  fallbackTeamId: string | null;
}): RoutingResult {
  const rules = [...args.rules].sort((a, b) => a.order - b.order);
  for (const r of rules) {
    if (ruleMatches(r, args.ticket)) return { teamId: r.targetTeamId, agentId: r.targetAgentId, source: "rule", ruleId: r.id };
  }
  if (args.subcategory?.defaultTeamId) return { teamId: args.subcategory.defaultTeamId, agentId: null, source: "subcategory" };
  if (args.category.defaultTeamId) return { teamId: args.category.defaultTeamId, agentId: null, source: "category" };
  if (args.fallbackTeamId) return { teamId: args.fallbackTeamId, agentId: null, source: "fallback" };
  return { teamId: null, agentId: null, source: "none" };
}
