"use client";
import { useActionState, useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { decideApprovalAction, savePolicyAction } from "@/server/actions/approvals";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";

/** Approve / reject buttons with a confirmation dialog (comment required for rejection). */
export function DecisionButtons({ approvalId, ticketNumber }: { approvalId: string; ticketNumber: string }) {
  const [state, action, pending] = useActionState(decideApprovalAction, null);
  const [mode, setMode] = useState<"APPROVED" | "REJECTED" | null>(null);
  useEffect(() => { if (state?.ok) setMode(null); }, [state]);
  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setMode("APPROVED")} data-testid="approve"><Check /> Approve</Button>
        <Button size="sm" variant="outline" onClick={() => setMode("REJECTED")} data-testid="reject"><X /> Reject</Button>
      </div>
      <Dialog open={!!mode} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "APPROVED" ? "Approve" : "Reject"} {ticketNumber}</DialogTitle>
            <DialogDescription>{mode === "APPROVED" ? "The request continues to IT (or to the next approver)." : "The requester is notified and the ticket is cancelled."}</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="approvalId" value={approvalId} />
            <input type="hidden" name="decision" value={mode ?? ""} />
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <Field label={mode === "REJECTED" ? "Reason (required)" : "Comment (optional)"} htmlFor="ap-comment" required={mode === "REJECTED"}>
              <Textarea id="ap-comment" name="comment" rows={3} required={mode === "REJECTED"} data-testid="decision-comment" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMode(null)}>Cancel</Button>
              <Button type="submit" disabled={pending} variant={mode === "REJECTED" ? "destructive" : "default"} data-testid="confirm-decision">{mode === "APPROVED" ? "Approve" : "Reject"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Opt = { id: string; name: string };
type StepIn = { name: string; approverType: string; approverUserId: string | null; fallbackUserId: string | null };
export interface PolicyIn { id?: string; name: string; categoryId: string; isActive: boolean; steps: StepIn[] }

export function PolicyDialog({ policy, categories, users, trigger }: {
  policy?: PolicyIn; categories: (Opt & { children: Opt[] })[]; users: Opt[]; trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(savePolicyAction, null);
  const [steps, setSteps] = useState<StepIn[]>(policy?.steps.length ? policy.steps : [{ name: "Line manager approval", approverType: "REQUESTER_MANAGER", approverUserId: null, fallbackUserId: null }]);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const upd = (i: number, patch: Partial<StepIn>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const userSelect = (name: string, value: string | null, label: string, optional: boolean) => (
    <NativeSelect name={name} defaultValue={value ?? ""} aria-label={label}>
      <option value="">{optional ? "— none —" : "Select user…"}</option>
      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </NativeSelect>
  );
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{policy?.id ? "Edit approval policy" : "New approval policy"}</DialogTitle>
            <DialogDescription>Applies to new tickets in the chosen category or subcategory (a subcategory policy wins). Steps run in order.</DialogDescription></DialogHeader>
          <form action={action} className="space-y-4">
            {policy?.id && <input type="hidden" name="policyId" value={policy.id} />}
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="pol-name" required><Input id="pol-name" name="name" defaultValue={policy?.name} required /></Field>
              <Field label="Category" htmlFor="pol-cat" required>
                <NativeSelect id="pol-cat" name="categoryId" defaultValue={policy?.categoryId ?? ""} required>
                  <option value="">Select…</option>
                  {categories.map((c) => (
                    <optgroup key={c.id} label={c.name}>
                      <option value={c.id}>{c.name} (whole category)</option>
                      {c.children.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </optgroup>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={policy?.isActive ?? true} className="size-4 accent-primary" /> Active</label>
            <div className="space-y-3">
              {steps.map((s, i) => (
                <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  <Input name={`steps.${i}.name`} value={s.name} onChange={(e) => upd(i, { name: e.target.value })} aria-label={`Step ${i + 1} name`} required />
                  <NativeSelect name={`steps.${i}.approverType`} value={s.approverType} onChange={(e) => upd(i, { approverType: e.target.value })} aria-label={`Step ${i + 1} approver type`}>
                    <option value="REQUESTER_MANAGER">Requester&apos;s manager</option><option value="SPECIFIC_USER">Specific user</option>
                  </NativeSelect>
                  {s.approverType === "SPECIFIC_USER" ? userSelect(`steps.${i}.approverUserId`, s.approverUserId, `Step ${i + 1} approver`, false) : <span className="self-center text-xs text-muted-foreground">Resolved from the requester&apos;s profile</span>}
                  <div className="flex gap-2">
                    {userSelect(`steps.${i}.fallbackUserId`, s.fallbackUserId, `Step ${i + 1} fallback approver`, true)}
                    {steps.length > 1 && <Button type="button" size="icon" variant="ghost" aria-label="Remove step" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}><Trash2 /></Button>}
                  </div>
                </div>
              ))}
              {steps.length < 5 && <Button type="button" size="sm" variant="outline" onClick={() => setSteps((x) => [...x, { name: `Step ${x.length + 1}`, approverType: "SPECIFIC_USER", approverUserId: null, fallbackUserId: null }])}><Plus /> Add step</Button>}
              <p className="text-xs text-muted-foreground">Fallback approver is used when the manager is missing or inactive, or when the approver would be the requester.</p>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending} data-testid="save-policy">Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
