"use client";
import { useActionState, useEffect, useState } from "react";
import { Link2, MapPin, Megaphone, Siren, CheckCircle2, Unlink } from "lucide-react";
import { declareMajorAction, linkTicketAction, postIncidentUpdateAction, reportAffectedAction, resolveIncidentAction, setImpactAction, unlinkTicketAction } from "@/server/actions/incidents";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { IMPACT_SCOPES, type ImpactScopeCode } from "@/server/domain/impact";
import { useTranslations } from "next-intl";

type Branch = { id: string; name: string };
type Result = { ok: boolean; error?: string; message?: string } | null;

function useDialog(state: Result) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  return [open, setOpen] as const;
}

/** Scope select + branch checklist — reused by the create form and the impact dialog. */
export function ImpactFields({ branches, defaultScope, defaultBranchIds = [], branchField = "branchIds", optional = false }: {
  branches: Branch[]; defaultScope?: string | null; defaultBranchIds?: string[]; branchField?: string; optional?: boolean;
}) {
  const tim = useTranslations("impact");
  const tinc = useTranslations("inc");
  const [scope, setScope] = useState<string>(defaultScope ?? "");
  const showBranches = scope === "SINGLE_BRANCH" || scope === "MULTIPLE_BRANCHES" || scope === "SINGLE_USER";
  return (
    <div className="space-y-3">
      <Field label={tinc("impactScope")} htmlFor="impactScope" required={!optional}>
        <NativeSelect id="impactScope" name="impactScope" value={scope} onChange={(e) => setScope(e.target.value)} required={!optional} data-testid="impact-scope">
          <option value="">{optional ? tinc("notSpecified") : tinc("select")}</option>
          {IMPACT_SCOPES.map((s) => <option key={s} value={s}>{tim(s as ImpactScopeCode)}</option>)}
        </NativeSelect>
      </Field>
      {showBranches && (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">{scope === "SINGLE_BRANCH" && optional ? tinc("impactedBranchesDefault") : tinc("impactedBranches")}</legend>
          <div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2" data-testid="impact-branches">
            {branches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={branchField} value={b.id} defaultChecked={defaultBranchIds.includes(b.id)} className="size-4 accent-primary" /> {b.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

export function ImpactDialog({ ticketId, branches, scope, branchIds, userCount }: { ticketId: string; branches: Branch[]; scope: string | null; branchIds: string[]; userCount: number | null }) {
  const tinc = useTranslations("inc");
  const [state, action, pending] = useActionState(setImpactAction, null);
  const [open, setOpen] = useDialog(state);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="set-impact"><MapPin /> {tinc("setImpact")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tinc("businessImpact")}</DialogTitle><DialogDescription>{tinc("whichBranchesAndHowManyUsers")}</DialogDescription></DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="ticketId" value={ticketId} />
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <ImpactFields branches={branches} defaultScope={scope} defaultBranchIds={branchIds} />
            <Field label={tinc("approxAffectedUsers")} htmlFor="impactedUserCount"><Input id="impactedUserCount" name="impactedUserCount" type="number" min={1} defaultValue={userCount ?? ""} /></Field>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{tinc("cancel")}</Button><Button type="submit" disabled={pending} data-testid="save-impact">{tinc("save")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeclareDialog({ ticketId, hasImpact }: { ticketId: string; hasImpact: boolean }) {
  const tinc = useTranslations("inc");
  const [state, action, pending] = useActionState(declareMajorAction, null);
  const [open, setOpen] = useDialog(state);
  return (
    <>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)} data-testid="declare-major"><Siren /> {tinc("declareMajorIncident")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tinc("declareMajorIncident")}</DialogTitle><DialogDescription>{tinc("notifiesTheOwnerAndSupportingTeams")}</DialogDescription></DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="ticketId" value={ticketId} />
            {!hasImpact && <Alert variant="warning">{tinc("setTheImpactScopeAndBranches")}</Alert>}
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <Field label={tinc("initialCommunicationVisibleToAffectedEmployees")} htmlFor="mi-msg" required><Textarea id="mi-msg" name="message" rows={4} required minLength={5} data-testid="declare-message" /></Field>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{tinc("cancel")}</Button><Button type="submit" variant="destructive" disabled={pending} data-testid="confirm-declare">{tinc("declare")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function IncidentUpdateForm({ ticketId, current }: { ticketId: string; current: string }) {
  const tinc = useTranslations("inc");
  const [state, action, pending] = useActionState(postIncidentUpdateAction, null);
  const [key, setKey] = useState(0);
  useEffect(() => { if (state?.ok) setKey((k) => k + 1); }, [state]);
  return (
    <form action={action} key={key} className="space-y-2 rounded-md border p-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <NativeSelect name="status" defaultValue={current === "RESOLVED" ? "MONITORING" : current} className="w-40" aria-label={tinc("incidentStatus")} data-testid="update-status">
          <option value="INVESTIGATING">{tinc("investigating")}</option><option value="IDENTIFIED">{tinc("identified")}</option><option value="MONITORING">{tinc("monitoring")}</option>
        </NativeSelect>
      </div>
      <Textarea name="message" rows={2} placeholder={tinc("publicUpdateForAffectedUsers")} required minLength={3} aria-label={tinc("updateMessage")} data-testid="update-message" />
      <Button size="sm" type="submit" disabled={pending} data-testid="post-update"><Megaphone /> {tinc("postUpdate")}</Button>
    </form>
  );
}

export function LinkTicketForm({ ticketId }: { ticketId: string }) {
  const tinc = useTranslations("inc");
  const [state, action, pending] = useActionState(linkTicketAction, null);
  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <Input name="childNumber" placeholder={tinc("ticketNumberEGIt2026")} className="w-64" required aria-label={tinc("ticketNumberToLink")} data-testid="link-number" />
      <Button size="sm" variant="outline" type="submit" disabled={pending} data-testid="link-ticket"><Link2 /> {tinc("link")}</Button>
      {state && !state.ok && <p className="w-full text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="w-full text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>}
    </form>
  );
}

export function UnlinkButton({ childId }: { childId: string }) {
  const tinc = useTranslations("inc");
  return (
    <form action={unlinkTicketAction}>
      <input type="hidden" name="childId" value={childId} />
      <Button size="icon" variant="ghost" type="submit" aria-label={tinc("unlink")}><Unlink className="size-4" /></Button>
    </form>
  );
}

export function ResolveIncidentDialog({ ticketId, linkedCount, active }: { ticketId: string; linkedCount: number; active: boolean }) {
  const tinc = useTranslations("inc");
  const [state, action, pending] = useActionState(resolveIncidentAction, null);
  const [open, setOpen] = useDialog(state);
  return (
    <>
      {state?.ok && <div className="w-full" data-testid="resolve-result"><Alert variant="success">{state.message}</Alert></div>}
      {active && <Button size="sm" onClick={() => setOpen(true)} data-testid="resolve-incident"><CheckCircle2 /> {tinc("resolveIncident")}</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tinc("resolveMajorIncident")}</DialogTitle><DialogDescription>{tinc("postsTheFinalUpdateTheIncident")}</DialogDescription></DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="ticketId" value={ticketId} />
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <Field label={tinc("resolutionSummary")} htmlFor="mi-sum" required><Textarea id="mi-sum" name="summary" rows={4} required minLength={5} data-testid="resolve-summary" /></Field>
            {linkedCount > 0 && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="cascade" defaultChecked className="size-4 accent-primary" data-testid="resolve-cascade" />
                {tinc("alsoResolveLinked", { n: linkedCount })}</label>
            )}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{tinc("cancel")}</Button><Button type="submit" disabled={pending} data-testid="confirm-resolve">{tinc("resolve")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AffectedButton({ incidentId }: { incidentId: string }) {
  const tinc = useTranslations("inc");
  const [state, action, pending] = useActionState(reportAffectedAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="incidentId" value={incidentId} />
      <Button size="sm" variant="outline" type="submit" disabled={pending} data-testid="affected-too">{tinc("affectedToo")}</Button>
      {state && !state.ok && <span className="text-sm text-destructive">{state.error}</span>}
    </form>
  );
}
