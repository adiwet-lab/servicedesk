"use client";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { decideApprovalAction, savePolicyAction } from "@/server/actions/approvals";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";

/** Approve / reject buttons with a confirmation dialog (comment required for rejection). */
export function DecisionButtons({ approvalId, ticketNumber }: { approvalId: string; ticketNumber: string }) {
  const ta = useTranslations("approvals");
  const [state, action, pending] = useActionState(decideApprovalAction, null);
  const [mode, setMode] = useState<"APPROVED" | "REJECTED" | null>(null);
  useEffect(() => { if (state?.ok) setMode(null); }, [state]);
  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setMode("APPROVED")} data-testid="approve"><Check /> {ta("approve")}</Button>
        <Button size="sm" variant="outline" onClick={() => setMode("REJECTED")} data-testid="reject"><X /> {ta("reject")}</Button>
      </div>
      <Dialog open={!!mode} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "APPROVED" ? ta("approve") : ta("reject")} {ticketNumber}</DialogTitle>
            <DialogDescription>{mode === "APPROVED" ? ta("approveHint") : ta("rejectHint")}</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="approvalId" value={approvalId} />
            <input type="hidden" name="decision" value={mode ?? ""} />
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <Field label={mode === "REJECTED" ? ta("reasonRequired") : ta("commentOptional")} htmlFor="ap-comment" required={mode === "REJECTED"}>
              <Textarea id="ap-comment" name="comment" rows={3} required={mode === "REJECTED"} data-testid="decision-comment" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMode(null)}>{ta("cancel")}</Button>
              <Button type="submit" disabled={pending} variant={mode === "REJECTED" ? "destructive" : "default"} data-testid="confirm-decision">{mode === "APPROVED" ? ta("approve") : ta("reject")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Opt = { id: string; name: string };
type StepIn = { name: string; nameTh?: string | null; approverType: string; approverUserId: string | null; fallbackUserId: string | null };
export interface PolicyIn { id?: string; name: string; categoryId: string; isActive: boolean; steps: StepIn[] }

export function PolicyDialog({ policy, categories, users, trigger }: {
  policy?: PolicyIn; categories: (Opt & { children: Opt[] })[]; users: Opt[]; trigger: React.ReactNode;
}) {
  const ta = useTranslations("approvals");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(savePolicyAction, null);
  const [steps, setSteps] = useState<StepIn[]>(policy?.steps.length ? policy.steps : [{ name: ta("lineManager"), approverType: "REQUESTER_MANAGER", approverUserId: null, fallbackUserId: null }]);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const upd = (i: number, patch: Partial<StepIn>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const userSelect = (name: string, value: string | null, label: string, optional: boolean) => (
    <NativeSelect name={name} defaultValue={value ?? ""} aria-label={label}>
      <option value="">{optional ? ta("none") : ta("selectUser")}</option>
      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </NativeSelect>
  );
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{policy?.id ? ta("editPolicy") : ta("newPolicy")}</DialogTitle>
            <DialogDescription>{ta("policyHint")}</DialogDescription></DialogHeader>
          <form action={action} className="space-y-4">
            {policy?.id && <input type="hidden" name="policyId" value={policy.id} />}
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={ta("name")} htmlFor="pol-name" required><Input id="pol-name" name="name" defaultValue={policy?.name} required /></Field>
              <Field label={ta("category")} htmlFor="pol-cat" required>
                <NativeSelect id="pol-cat" name="categoryId" defaultValue={policy?.categoryId ?? ""} required>
                  <option value="">{ta("select")}</option>
                  {categories.map((c) => (
                    <optgroup key={c.id} label={c.name}>
                      <option value={c.id}>{c.name} {ta("wholeCategory")}</option>
                      {c.children.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </optgroup>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={policy?.isActive ?? true} className="size-4 accent-primary" /> {ta("active")}</label>
            <div className="space-y-3">
              {steps.map((s, i) => (
                <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  <Input name={`steps.${i}.name`} value={s.name} onChange={(e) => upd(i, { name: e.target.value })} aria-label={ta("stepName", { n: i + 1 })} required />
                  <Input name={`steps.${i}.nameTh`} value={s.nameTh ?? ""} onChange={(e) => upd(i, { nameTh: e.target.value })} aria-label={ta("stepNameTh", { n: i + 1 })} placeholder={ta("stepNameThPlaceholder")} />
                  <NativeSelect name={`steps.${i}.approverType`} value={s.approverType} onChange={(e) => upd(i, { approverType: e.target.value })} aria-label={ta("stepType", { n: i + 1 })}>
                    <option value="REQUESTER_MANAGER">{ta("managerType")}</option><option value="SPECIFIC_USER">{ta("specificUser")}</option>
                  </NativeSelect>
                  {s.approverType === "SPECIFIC_USER" ? userSelect(`steps.${i}.approverUserId`, s.approverUserId, ta("stepApprover", { n: i + 1 }), false) : <span className="self-center text-xs text-muted-foreground">{ta("fromProfile")}</span>}
                  <div className="flex gap-2">
                    {userSelect(`steps.${i}.fallbackUserId`, s.fallbackUserId, ta("stepFallback", { n: i + 1 }), true)}
                    {steps.length > 1 && <Button type="button" size="icon" variant="ghost" aria-label={ta("removeStep")} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}><Trash2 /></Button>}
                  </div>
                </div>
              ))}
              {steps.length < 5 && <Button type="button" size="sm" variant="outline" onClick={() => setSteps((x) => [...x, { name: ta("stepDefault", { n: x.length + 1 }), approverType: "SPECIFIC_USER", approverUserId: null, fallbackUserId: null }])}><Plus /> {ta("addStep")}</Button>}
              <p className="text-xs text-muted-foreground">{ta("fallbackHint")}</p>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{ta("cancel")}</Button><Button type="submit" disabled={pending} data-testid="save-policy">{ta("save")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
