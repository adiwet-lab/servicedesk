/**
 * Approval-chain resolution (pure, unit-tested).
 * Separation of duties: nobody approves their own request, and only active internal
 * users can approve. A step whose approver cannot be determined falls back to the
 * step's fallback user; if that is impossible too, the chain cannot be built.
 */
export interface StepDef { order: number; name: string; approverType: "REQUESTER_MANAGER" | "SPECIFIC_USER"; approverUserId: string | null; fallbackUserId: string | null }
export interface Candidate { id: string; active: boolean }
export interface ResolvedStep { order: number; name: string; approverId: string; viaFallback: boolean }

export function resolveApprovalChain(
  steps: StepDef[],
  requester: { id: string; managerId: string | null },
  users: Map<string, Candidate>,
): { ok: true; steps: ResolvedStep[] } | { ok: false; error: string } {
  const usable = (id: string | null | undefined): id is string => !!id && id !== requester.id && !!users.get(id)?.active;
  const out: ResolvedStep[] = [];
  for (const s of [...steps].sort((a, b) => a.order - b.order)) {
    const primary = s.approverType === "REQUESTER_MANAGER" ? requester.managerId : s.approverUserId;
    if (usable(primary)) { out.push({ order: s.order, name: s.name, approverId: primary, viaFallback: false }); continue; }
    if (usable(s.fallbackUserId)) { out.push({ order: s.order, name: s.name, approverId: s.fallbackUserId, viaFallback: true }); continue; }
    return { ok: false, error: `No approver is available for the approval step "${s.name}". Please contact IT.` };
  }
  if (!out.length) return { ok: false, error: "The approval policy has no steps." };
  return { ok: true, steps: out };
}

/** The next decision state after a step is approved. */
export function nextAfterApproval(steps: { stepOrder: number; decision: string }[], approvedOrder: number) {
  const next = steps.filter((s) => s.stepOrder > approvedOrder && s.decision === "WAITING").sort((a, b) => a.stepOrder - b.stepOrder)[0];
  return next ? { done: false as const, nextOrder: next.stepOrder } : { done: true as const };
}
