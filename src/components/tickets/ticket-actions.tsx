"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { ArrowRightLeft, ChevronDown, Upload, UserPlus } from "lucide-react";
import { assignTicketAction, changeStatusAction, teamAgentsAction, uploadAttachmentsAction } from "@/server/actions/tickets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NativeSelect, Textarea, Input } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";

interface Transition { id: string; name: string; kind: string; color: string; requiresReason: boolean }

export function StatusChanger({ ticketId, transitions, blockingTasks = [] }: { ticketId: string; transitions: Transition[]; blockingTasks?: { number: string; title: string }[] }) {
  const [target, setTarget] = useState<Transition | null>(null);
  const [state, action, pending] = useActionState(changeStatusAction, null);
  useEffect(() => { if (state?.ok) setTarget(null); }, [state]);
  if (!transitions.length) return null;
  const needsDialog = (t: Transition) => t.requiresReason || t.kind === "RESOLVED";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="change-status">Change status <ChevronDown /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {transitions.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => setTarget(t)} data-testid={`status-${t.name}`}>
              <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change status to “{target?.name}”</DialogTitle>
            <DialogDescription>
              {target?.kind === "RESOLVED" ? "Describe how the issue was resolved. The requester will be notified." :
                target?.requiresReason ? "A reason is required for this status." : "Confirm the status change."}
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="toStatusId" value={target?.id ?? ""} />
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            {target?.kind === "RESOLVED" && blockingTasks.length > 0 && (
              <Alert variant="warning">
                <strong>Required tasks still open:</strong>
                <ul className="mt-1 list-disc pl-5">{blockingTasks.map((b) => <li key={b.number}>{b.number} — {b.title}</li>)}</ul>
              </Alert>
            )}
            {target?.kind === "RESOLVED" ? (
              <Field label="Resolution summary" htmlFor="resolutionSummary" required>
                <Textarea id="resolutionSummary" name="resolutionSummary" required minLength={3} rows={5} />
              </Field>
            ) : target && needsDialog(target) ? (
              <Field label={target.kind === "WAITING" ? "Waiting reason" : "Reason"} htmlFor="reason" required>
                <Textarea id="reason" name="reason" required rows={4} />
              </Field>
            ) : (
              <Field label="Comment (optional)" htmlFor="reason"><Textarea id="reason" name="reason" rows={3} /></Field>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={pending} data-testid="confirm-status">{pending ? "Saving…" : "Confirm"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AssignDialog({ ticketId, teams, currentTeamId, currentAgentId, canTransfer, initialAgents }: {
  ticketId: string; teams: { id: string; name: string }[]; currentTeamId: string | null; currentAgentId: string | null;
  canTransfer: boolean; initialAgents: { id: string; displayName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState(currentTeamId ?? "");
  const [agents, setAgents] = useState(initialAgents);
  const [loading, startTransition] = useTransition();
  const [state, action, pending] = useActionState(assignTicketAction, null);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const transferring = teamId !== (currentTeamId ?? "");

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="assign-button"><UserPlus /> Assign</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign ticket</DialogTitle>
            <DialogDescription>Every assignment change is recorded in the ticket history.</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="ticketId" value={ticketId} />
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <Field label="Support team" htmlFor="teamId" hint={canTransfer ? "Changing the team transfers the ticket" : "You can assign within the current team"}>
              <NativeSelect id="teamId" name="teamId" value={teamId} disabled={!canTransfer}
                onChange={(e) => {
                  const id = e.target.value;
                  setTeamId(id);
                  startTransition(async () => setAgents(id ? await teamAgentsAction(id) : []));
                }}>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
              {!canTransfer && <input type="hidden" name="teamId" value={teamId} />}
            </Field>
            <Field label="Agent" htmlFor="agentId">
              <NativeSelect id="agentId" name="agentId" defaultValue={transferring ? "" : currentAgentId ?? ""} key={teamId} disabled={loading}>
                <option value="">Unassigned (team queue)</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
              </NativeSelect>
            </Field>
            <Field label={transferring ? "Transfer reason" : "Reason (optional)"} htmlFor="assign-reason" required={transferring}>
              <Input id="assign-reason" name="reason" required={transferring} maxLength={1000} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{transferring ? <><ArrowRightLeft /> Transfer</> : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AttachmentUploader({ ticketId, allowed }: { ticketId: string; allowed: string[] }) {
  const [state, action, pending] = useActionState(uploadAttachmentsAction, null);
  return (
    <form action={action} className="space-y-2" encType="multipart/form-data">
      <input type="hidden" name="ticketId" value={ticketId} />
      <div className="flex items-center gap-2">
        <input name="attachments" type="file" multiple accept={allowed.map((e) => `.${e}`).join(",")} className="text-sm file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm" aria-label="Choose files" />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}><Upload /> {pending ? "Uploading…" : "Upload"}</Button>
      </div>
      {state && !state.ok && <p className="text-xs text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-xs text-success">Uploaded.</p>}
    </form>
  );
}
