"use client";
import { useActionState, useEffect, useState } from "react";
import { ArrowUpCircle, Pencil, Plus, X } from "lucide-react";
import { addSupportingTeamAction, escalateTicketAction, removeSupportingTeamAction, updateTicketAction } from "@/server/actions/tasks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { cn, formatDateTime } from "@/lib/utils";

type Opt = { id: string; name: string };
export interface EditOptions {
  categories: (Opt & { children: Opt[] })[];
  priorities: { id: string; code: string; name: string; level: number }[];
  branches: (Opt & { locations: Opt[] })[];
  teams: (Opt & { type: string })[];
}
export interface EditableTicket {
  id: string; subject: string; description: string; categoryId: string; subcategoryId: string | null; priorityId: string;
  branchId: string | null; locationId: string | null; contactNumber: string | null; relatedAsset: string | null;
  affectedSystem: string | null; affectedUsers: string | null; isConfidential: boolean; ownerTeamId: string | null;
}

export function EditTicketDialog({ ticket, options }: { ticket: EditableTicket; options: EditOptions }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateTicketAction, null);
  const [catId, setCatId] = useState(ticket.categoryId);
  const [branchId, setBranchId] = useState(ticket.branchId ?? "");
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const cat = options.categories.find((c) => c.id === catId);
  const locations = options.branches.find((b) => b.id === branchId)?.locations ?? [];
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="edit-ticket"><Pencil /> Edit</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit ticket</DialogTitle>
            <DialogDescription>Each change is recorded in the ticket history and audit log. Priority/category changes recalculate SLA due dates.</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="ticketId" value={ticket.id} />
            {state && !state.ok && <Alert variant="destructive" className="sm:col-span-2">{state.error}</Alert>}
            <Field label="Subject" htmlFor="ed-subject" required error={fe.subject} className="sm:col-span-2"><Input id="ed-subject" name="subject" defaultValue={ticket.subject} required /></Field>
            <Field label="Description" htmlFor="ed-desc" required error={fe.description} className="sm:col-span-2"><Textarea id="ed-desc" name="description" defaultValue={ticket.description} rows={4} required /></Field>
            <Field label="Main category" htmlFor="ed-cat" error={fe.categoryId}>
              <NativeSelect id="ed-cat" name="categoryId" value={catId} onChange={(e) => setCatId(e.target.value)}>
                {options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Subcategory" htmlFor="ed-sub" error={fe.subcategoryId}>
              <NativeSelect id="ed-sub" name="subcategoryId" key={catId} defaultValue={catId === ticket.categoryId ? ticket.subcategoryId ?? "" : ""}>
                <option value="">—</option>{cat?.children.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Priority" htmlFor="ed-prio" error={fe.priorityId}>
              <NativeSelect id="ed-prio" name="priorityId" defaultValue={ticket.priorityId} data-testid="edit-priority">
                {options.priorities.map((p) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="isConfidential" defaultChecked={ticket.isConfidential} className="size-4 accent-primary" /> Confidential</label>
            <Field label="Branch" htmlFor="ed-branch"><NativeSelect id="ed-branch" name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">—</option>{options.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></Field>
            <Field label="Location" htmlFor="ed-loc" error={fe.locationId}><NativeSelect id="ed-loc" name="locationId" key={branchId} defaultValue={branchId === ticket.branchId ? ticket.locationId ?? "" : ""}><option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></Field>
            <Field label="Contact number" htmlFor="ed-contact" error={fe.contactNumber}><Input id="ed-contact" name="contactNumber" defaultValue={ticket.contactNumber ?? ""} /></Field>
            <Field label="Related asset" htmlFor="ed-asset" error={fe.relatedAsset}><Input id="ed-asset" name="relatedAsset" defaultValue={ticket.relatedAsset ?? ""} /></Field>
            <Field label="Affected system" htmlFor="ed-sys" error={fe.affectedSystem}><Input id="ed-sys" name="affectedSystem" defaultValue={ticket.affectedSystem ?? ""} /></Field>
            <Field label="Affected users" htmlFor="ed-users" error={fe.affectedUsers}><Input id="ed-users" name="affectedUsers" defaultValue={ticket.affectedUsers ?? ""} /></Field>
            <Field label="Reason for change (optional)" htmlFor="ed-reason" className="sm:col-span-2"><Input id="ed-reason" name="reason" /></Field>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending} data-testid="save-ticket">Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EscalateDialog({ ticketId, currentPriorityLevel, currentTeamId, options }: {
  ticketId: string; currentPriorityLevel: number; currentTeamId: string | null; options: EditOptions;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(escalateTicketAction, null);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="escalate"><ArrowUpCircle /> Escalate</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escalate ticket</DialogTitle>
            <DialogDescription>Raise the priority and/or move the ticket to another team. The target team&apos;s leads are notified.</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="ticketId" value={ticketId} />
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <Field label="Escalate to team" htmlFor="esc-team">
              <NativeSelect id="esc-team" name="teamId" defaultValue={currentTeamId ?? ""}>{options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
            </Field>
            <Field label="Raise priority to" htmlFor="esc-prio">
              <NativeSelect id="esc-prio" name="priorityId" defaultValue="">
                <option value="">Keep current priority</option>
                {options.priorities.filter((p) => p.level < currentPriorityLevel).map((p) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Reason" htmlFor="esc-reason" required><Textarea id="esc-reason" name="reason" required minLength={5} rows={3} /></Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={pending}>Escalate</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TeamsCard({ ticketId, owner, agent, supporting, openTasksByTeam, canManage, teams }: {
  ticketId: string; owner: Opt | null; agent: string | null; supporting: (Opt & { type: string })[];
  openTasksByTeam: Record<string, number>; canManage: boolean; teams: Opt[];
}) {
  const [addState, addAction, adding] = useActionState(addSupportingTeamAction, null);
  const [rmState, rmAction] = useActionState(removeSupportingTeamAction, null);
  const available = teams.filter((t) => t.id !== owner?.id && !supporting.some((s) => s.id === t.id));
  const err = (addState && !addState.ok && addState.error) || (rmState && !rmState.ok && rmState.error);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Teams</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm" data-testid="teams-card">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Main owner team</p>
          <p className="font-medium">{owner?.name ?? "—"} {owner && openTasksByTeam[owner.id] ? <Badge variant="secondary">{openTasksByTeam[owner.id]} open task(s)</Badge> : null}</p>
          <p className="text-muted-foreground">Responsible agent: {agent ?? "Unassigned"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Supporting teams</p>
          {supporting.length === 0 && <p className="text-muted-foreground">None</p>}
          <ul className="space-y-1">
            {supporting.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="flex-1">{s.name} {s.type !== "INTERNAL" && <Badge variant="warning">External</Badge>}</span>
                {openTasksByTeam[s.id] ? <Badge variant="secondary">{openTasksByTeam[s.id]} open</Badge> : null}
                {canManage && (
                  <form action={rmAction}>
                    <input type="hidden" name="ticketId" value={ticketId} /><input type="hidden" name="teamId" value={s.id} />
                    <button type="submit" aria-label={`Remove ${s.name}`} className="rounded p-1 hover:bg-accent"><X className="size-3.5" /></button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
        {canManage && available.length > 0 && (
          <form action={addAction} className="flex gap-2">
            <input type="hidden" name="ticketId" value={ticketId} />
            <NativeSelect name="teamId" required className="h-8 flex-1 text-xs" aria-label="Add supporting team">
              <option value="">Add supporting team…</option>{available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
            <Button type="submit" size="sm" variant="secondary" disabled={adding}><Plus /> Add</Button>
          </form>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

type TimelineItem = {
  id: string; action: string; field: string | null; oldValue: string | null; newValue: string | null; reason: string | null;
  createdAt: Date | string; category: string; actor: { displayName: string } | null;
};
const LABEL: Record<string, string> = {
  CREATED: "created the ticket", STATUS_CHANGED: "changed status", REOPENED: "reopened the ticket", TEAM_CHANGED: "transferred to team",
  AGENT_CHANGED: "changed assignee", ATTACHMENT_ADDED: "added attachment", ATTACHMENT_REMOVED: "removed attachment", FIELD_UPDATED: "updated",
  CATEGORY_CHANGED: "changed category", PRIORITY_CHANGED: "changed priority", ESCALATED: "escalated the ticket",
  SUPPORTING_TEAM_ADDED: "added supporting team", SUPPORTING_TEAM_REMOVED: "removed supporting team",
  TASK_CREATED: "created task", TASK_STATUS_CHANGED: "changed task status", TASK_ASSIGNED: "assigned task",
};
const FILTERS = [["all", "All"], ["status", "Status"], ["assignment", "Assignment"], ["tasks", "Tasks"], ["fields", "Fields"], ["attachments", "Attachments"]] as const;
const DOT: Record<string, string> = { status: "bg-primary", assignment: "bg-violet-500", tasks: "bg-amber-500", fields: "bg-sky-500", attachments: "bg-slate-400", other: "bg-slate-400" };

export function TimelineView({ items }: { items: TimelineItem[] }) {
  const [filter, setFilter] = useState<string>("all");
  const shown = filter === "all" ? items : items.filter((i) => i.category === filter);
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter timeline">
          {FILTERS.map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
              {label} <span className="opacity-70">{k === "all" ? items.length : items.filter((i) => i.category === k).length}</span>
            </button>
          ))}
        </div>
        <ol className="relative space-y-5 border-l pl-6" data-testid="timeline">
          {shown.map((h) => (
            <li key={h.id} className="relative">
              <span className={cn("absolute -left-[31px] top-0.5 size-4 rounded-full border-2 border-card", DOT[h.category] ?? DOT.other)} />
              <p className="text-sm">
                <span className="font-medium">{h.actor?.displayName ?? "System"}</span>{" "}
                <span className="text-muted-foreground">{LABEL[h.action] ?? h.action.toLowerCase().replaceAll("_", " ")}</span>
                {h.field && ["FIELD_UPDATED", "TASK_STATUS_CHANGED", "TASK_ASSIGNED"].includes(h.action) && <span className="text-muted-foreground"> {h.field}:</span>}
                {h.oldValue || h.newValue ? (
                  <span> {h.oldValue && <><span className="line-through decoration-muted-foreground/50">{h.oldValue}</span> → </>}<span className="font-medium">{h.newValue}</span></span>
                ) : null}
              </p>
              {h.reason && <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">{h.reason}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
            </li>
          ))}
          {shown.length === 0 && <li className="text-sm text-muted-foreground">No entries.</li>}
        </ol>
      </CardContent>
    </Card>
  );
}
