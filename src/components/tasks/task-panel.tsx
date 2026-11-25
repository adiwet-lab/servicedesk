"use client";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { AlertTriangle, CalendarClock, Download, FileText, ListChecks, Plus, Trash2, UserCheck, Users } from "lucide-react";
import type { TaskStatus } from "@prisma/client";
import type { TaskProgress } from "@/server/domain/task-workflow";
import { TASK_STATUS_LABEL, isTaskOverdue, taskStatusRequiresReason } from "@/server/domain/task-workflow";
import type { TicketTaskWithPerm } from "@/server/services/tasks";
import {
  assignTaskAction, createTaskAction, removeTaskAttachmentAction, taskSelfAssignAction, taskStatusAction, updateTaskAction, uploadTaskAttachmentsAction,
} from "@/server/actions/tasks";
import { teamAgentsAction } from "@/server/actions/tickets";
import { Button } from "@/components/ui/button";
import { Badge, ColorBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, EmptyState, Field } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { useFormat } from "@/i18n/client";
import { ln } from "@/lib/localized";
import type { Locale } from "@/i18n/config";
import { ProgressBar, TaskStatusBadge } from "./task-badges";

type Opt = { id: string; name: string };
type Prio = { id: string; code: string; name: string };

const toLocalInput = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const date = new Date(d);
  const off = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - off).toISOString().slice(0, 16);
};

export function TaskPanel({
  ticketId, tasks, progress, hiddenCount, canCreate, readOnly, teams, priorities, defaultTeamId,
}: {
  ticketId: string; tasks: TicketTaskWithPerm[]; progress: TaskProgress; hiddenCount: number; canCreate: boolean; readOnly: boolean;
  teams: Opt[]; priorities: Prio[]; defaultTeamId: string | null;
}) {
  const tk = useTranslations("tasks"); const f = useFormat(); const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const selectedNumber = search.get("task");
  const selected = tasks.find((t) => t.number === selectedNumber) ?? null;
  const [creating, setCreating] = useState(false);
  const now = new Date();

  const open = (num: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (num) sp.set("task", num); else sp.delete("task");
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-56 flex-1 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{tk("progress")}</span>
              <span className="text-muted-foreground" data-testid="task-progress">
                {tk("progressLine", { done: progress.completed, total: progress.total, reqDone: progress.requiredCompleted, req: progress.required })}
              </span>
            </div>
            <ProgressBar percent={progress.percent} />
          </div>
          {canCreate && <Button onClick={() => setCreating(true)} data-testid="new-task"><Plus /> {tk("newTask")}</Button>}
        </div>
        {progress.openRequired > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-4" /> {tk("openRequired", { count: progress.openRequired })}
          </p>
        )}
        {tasks.length === 0 ? (
          <EmptyState icon={<ListChecks />} title={tk("noTasks")} description={canCreate ? tk("splitTheWorkAcrossTeamsBy") : hiddenCount ? tk("hiddenOnly", { count: hiddenCount }) : undefined} />
        ) : (
          <Table data-testid="task-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{tk("task")}</TableHead><TableHead>{tk("title")}</TableHead><TableHead>{tk("teamAgent")}</TableHead><TableHead>{tk("priority")}</TableHead>
                <TableHead>{tk("status")}</TableHead><TableHead>{tk("due")}</TableHead><TableHead>{tk("type")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => {
                const overdue = isTaskOverdue({ dueDate: t.dueDate ? new Date(t.dueDate) : null, status: t.status }, now);
                return (
                  <TableRow key={t.id} className={cn("cursor-pointer", overdue && "bg-destructive/5")} onClick={() => open(t.number)} data-testid={`task-row-${t.number}`}>
                    <TableCell className="font-mono text-xs font-semibold text-primary whitespace-nowrap">{t.number}</TableCell>
                    <TableCell className="max-w-64 font-medium">{t.title}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap"><div>{t.team ? ln(t.team, locale) : "—"}</div><div className="text-muted-foreground">{t.assignedAgent?.displayName ?? tk("unassigned")}</div></TableCell>
                    <TableCell>{t.priority ? <ColorBadge color={t.priority.color}>{t.priority.code}</ColorBadge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><TaskStatusBadge status={t.status} /></TableCell>
                    <TableCell className={cn("text-xs whitespace-nowrap", overdue && "font-semibold text-destructive")}>{t.dueDate ? f.dateTime(t.dueDate) : "—"}{overdue && tk("overdueSuffix")}</TableCell>
                    <TableCell>{t.isRequired ? <Badge>{tk("required")}</Badge> : <Badge variant="outline">{tk("optional")}</Badge>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {hiddenCount > 0 && tasks.length > 0 && <p className="text-xs text-muted-foreground">{tk("hiddenOthers", { count: hiddenCount })}</p>}
      </CardContent>

      {canCreate && (
        <NewTaskDialog open={creating} onClose={() => setCreating(false)} ticketId={ticketId} teams={teams} priorities={priorities} defaultTeamId={defaultTeamId}
          onCreated={(num) => { setCreating(false); open(num); }} />
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && open(null)}>
        <SheetContent aria-describedby={undefined}>
          {selected && <TaskDrawer task={selected} teams={teams} priorities={priorities} readOnly={readOnly} key={`${selected.id}-${selected.updatedAt}`} />}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function NewTaskDialog({ open, onClose, ticketId, teams, priorities, defaultTeamId, onCreated }: {
  open: boolean; onClose: () => void; ticketId: string; teams: Opt[]; priorities: Prio[]; defaultTeamId: string | null; onCreated: (num: string) => void;
}) {
  const tk = useTranslations("tasks");
  const [state, action, pending] = useActionState(createTaskAction, null);
  const [teamId, setTeamId] = useState(defaultTeamId ?? "");
  const [agents, setAgents] = useState<{ id: string; displayName: string }[]>([]);
  const [, start] = useTransition();
  useEffect(() => { if (teamId) start(async () => setAgents(await teamAgentsAction(teamId))); }, [teamId]);
  useEffect(() => { if (state?.ok && state.data) onCreated(state.data.number); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{tk("newTask")}</DialogTitle>
          <DialogDescription>{tk("tasksLetOtherTeamsContributeWithout")}</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="ticketId" value={ticketId} />
          {state && !state.ok && <Alert variant="destructive" className="sm:col-span-2">{state.error}</Alert>}
          <Field label={tk("title")} htmlFor="task-title" required error={fe.title} className="sm:col-span-2"><Input id="task-title" name="title" required maxLength={200} /></Field>
          <Field label={tk("description")} htmlFor="task-desc" className="sm:col-span-2"><Textarea id="task-desc" name="description" rows={3} /></Field>
          <Field label={tk("team")} htmlFor="task-team" required error={fe.teamId}>
            <NativeSelect id="task-team" name="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
              <option value="">{tk("select")}</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={tk("agent")} htmlFor="task-agent" error={fe.agentId} hint={tk("optional")}>
            <NativeSelect id="task-agent" name="agentId" key={teamId}>
              <option value="">{tk("unassignedTeamQueue")}</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </NativeSelect>
          </Field>
          <Field label={tk("priority")} htmlFor="task-prio"><NativeSelect id="task-prio" name="priorityId"><option value="">—</option>{priorities.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</NativeSelect></Field>
          <Field label={tk("dueDate")} htmlFor="task-due" error={fe.dueDate}><Input id="task-due" name="dueDate" type="datetime-local" /></Field>
          <Field label={tk("startDate")} htmlFor="task-start"><Input id="task-start" name="startDate" type="datetime-local" /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="isRequired" defaultChecked className="size-4 accent-primary" /> {tk("requiredToResolveTheTicket")}</label>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>{tk("cancel")}</Button>
            <Button type="submit" disabled={pending} data-testid="create-task">{pending ? tk("creating") : tk("createTask")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskDrawer({ task, teams, priorities, readOnly }: { task: TicketTaskWithPerm; teams: Opt[]; priorities: Prio[]; readOnly: boolean }) {
  const tk = useTranslations("tasks"); const tkStatus = useTranslations("taskStatus"); const f = useFormat(); const locale = useLocale() as Locale;
  const overdue = isTaskOverdue({ dueDate: task.dueDate ? new Date(task.dueDate) : null, status: task.status });
  const [target, setTarget] = useState<TaskStatus | null>(null);
  const [statusState, statusAction, statusPending] = useActionState(taskStatusAction, null);
  useEffect(() => { if (statusState?.ok) setTarget(null); }, [statusState]);

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-primary">{task.number}</span>
          <TaskStatusBadge status={task.status} />
          {task.isRequired ? <Badge>{tk("required")}</Badge> : <Badge variant="outline">{tk("optional")}</Badge>}
          {overdue && <Badge variant="destructive">{tk("overdue")}</Badge>}
        </div>
        <SheetTitle data-testid="task-drawer-title">{task.title}</SheetTitle>
        <SheetDescription>
          <Users className="mr-1 inline size-3.5" />{task.team ? ln(task.team, locale) : tk("noTeam")} · {task.assignedAgent?.displayName ?? tk("unassigned")}
          {task.dueDate && <> · <CalendarClock className="mx-1 inline size-3.5" />{tk("dueOn", { date: f.dateTime(task.dueDate) })}</>}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {!readOnly && (task.perm.transitions.length > 0 || task.perm.canAssign) && (
          <section className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {task.perm.transitions.map((s) => (
                <Button key={s} size="sm" variant={s === "COMPLETED" ? "default" : s === "CANCELLED" ? "outline" : "secondary"}
                  onClick={() => setTarget(s)} data-testid={`task-status-${s}`}>
                  {s === "IN_PROGRESS" && task.status === "COMPLETED" ? tk("reopen") : tkStatus(s)}
                </Button>
              ))}
              {task.perm.canAssign && !task.perm.isMine && (
                <form action={taskSelfAssignAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="teamId" value={task.teamId ?? ""} />
                  <Button size="sm" variant="outline" type="submit" data-testid="task-assign-me"><UserCheck /> {tk("assignToMe")}</Button>
                </form>
              )}
            </div>
            {target && (
              <form action={statusAction} className="space-y-2 rounded-lg border p-3">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="status" value={target} />
                <p className="text-sm font-medium">{tk("changeTo", { status: tkStatus(target) })}</p>
                {statusState && !statusState.ok && <Alert variant="destructive">{statusState.error}</Alert>}
                <Textarea name="reason" rows={2} required={taskStatusRequiresReason(target)} placeholder={taskStatusRequiresReason(target) ? tk("reasonRequired") : tk("commentOptional")} aria-label={tk("reason")} />
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setTarget(null)}>{tk("cancel")}</Button>
                  <Button type="submit" size="sm" disabled={statusPending} data-testid="task-status-confirm">{tk("confirm")}</Button>
                </div>
              </form>
            )}
          </section>
        )}

        {task.description && <section><h4 className="mb-1 text-sm font-semibold">{tk("description")}</h4><p className="whitespace-pre-wrap text-sm">{task.description}</p></section>}

        {!readOnly && task.perm.canAssignOthers && task.perm.canWork && <AssignForm task={task} teams={teams} />}
        {!readOnly && task.perm.canWork && <EditForm task={task} priorities={priorities} />}

        <section className="space-y-2">
          <h4 className="text-sm font-semibold">{tk("attachments")}</h4>
          {task.attachments.length === 0 && <p className="text-sm text-muted-foreground">{tk("noAttachments")}</p>}
          <ul className="divide-y">
            {task.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
                <FileText className="size-4 text-muted-foreground" />
                <a href={`/api/attachments/${a.id}`} className="flex-1 truncate hover:underline">{a.fileName}</a>
                <span className="text-xs text-muted-foreground">{f.bytes(a.sizeBytes)} · {a.uploadedBy.displayName}</span>
                <a href={`/api/attachments/${a.id}`} aria-label={tk("download")}><Download className="size-4" /></a>
                {!readOnly && task.perm.canWork && (
                  <form action={removeTaskAttachmentAction}><input type="hidden" name="attachmentId" value={a.id} />
                    <button type="submit" aria-label={tk("removeAttachment")}><Trash2 className="size-4 text-destructive" /></button></form>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && task.perm.canWork && <TaskUploader taskId={task.id} />}
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-semibold">{tk("taskHistory")}</h4>
          <ol className="space-y-2 border-l pl-4" data-testid="task-history">
            {task.history.map((h) => (
              <li key={h.id} className="text-sm">
                <span className="font-medium">{h.actor?.displayName ?? tk("system")}</span>{" "}
                <span className="text-muted-foreground">{h.action === "COMMENT" ? tk("commented") : h.action.toLowerCase().replaceAll("_", " ")}{h.field ? ` (${h.field})` : ""}</span>{" "}
                {h.oldValue && <><span className="line-through decoration-muted-foreground/50">{h.oldValue}</span> → </>}
                {h.newValue && <span className={h.action === "COMMENT" ? "block rounded bg-muted px-2 py-1" : "font-medium"}>{h.newValue}</span>}
                <span className="block text-xs text-muted-foreground">{f.dateTime(h.createdAt)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

function AssignForm({ task, teams }: { task: TicketTaskWithPerm; teams: Opt[] }) {
  const tk = useTranslations("tasks"); const f = useFormat(); const locale = useLocale() as Locale;
  const [state, action, pending] = useActionState(assignTaskAction, null);
  const [teamId, setTeamId] = useState(task.teamId ?? "");
  const [agents, setAgents] = useState<{ id: string; displayName: string }[]>([]);
  const [, start] = useTransition();
  useEffect(() => { if (teamId) start(async () => setAgents(await teamAgentsAction(teamId))); }, [teamId]);
  const moving = teamId !== (task.teamId ?? "");
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">{tk("assignment")}</h4>
      <form action={action} className="grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="taskId" value={task.id} />
        {state && !state.ok && <Alert variant="destructive" className="sm:col-span-2">{state.error}</Alert>}
        {state?.ok && <p className="text-sm text-success sm:col-span-2">{tk("assignmentUpdated")}</p>}
        <NativeSelect name="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label={tk("taskTeam")}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </NativeSelect>
        <NativeSelect name="agentId" key={teamId} defaultValue={moving ? "" : task.assignedAgentId ?? ""} aria-label={tk("taskAgent")} data-testid="task-agent-select">
          <option value="">{tk("unassigned")}</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
        </NativeSelect>
        <Input name="reason" placeholder={moving ? tk("reasonRequiredToMoveTeam") : tk("reasonOptional")} required={moving} className="sm:col-span-2" aria-label={tk("assignmentReason")} />
        <div className="sm:col-span-2"><Button type="submit" size="sm" variant="secondary" disabled={pending} data-testid="task-assign-save">{tk("saveAssignment")}</Button></div>
      </form>
      {task.assignments.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {task.assignments.map((a) => <li key={a.id}>{f.dateTime(a.createdAt)} · {a.changedBy?.displayName ?? tk("system")}: {a.team ? ln(a.team, locale) : "—"} / {a.agent?.displayName ?? tk("unassigned")}{a.reason ? ` — “${a.reason}”` : ""}</li>)}
        </ul>
      )}
    </section>
  );
}

function EditForm({ task, priorities }: { task: TicketTaskWithPerm; priorities: Prio[] }) {
  const tk = useTranslations("tasks");
  const [state, action, pending] = useActionState(updateTaskAction, null);
  const [openEdit, setOpenEdit] = useState(false);
  const fe = useMemo(() => (state && !state.ok ? state.fieldErrors ?? {} : {}), [state]);
  if (!openEdit) return <Button size="sm" variant="outline" onClick={() => setOpenEdit(true)}>{tk("editTaskDetails")}</Button>;
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">{tk("editTask")}</h4>
      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="taskId" value={task.id} />
        {state && !state.ok && <Alert variant="destructive" className="sm:col-span-2">{state.error}</Alert>}
        {state?.ok && <p className="text-sm text-success sm:col-span-2">{tk("saved")}</p>}
        <Field label={tk("title")} htmlFor="et-title" error={fe.title} className="sm:col-span-2"><Input id="et-title" name="title" defaultValue={task.title} required /></Field>
        <Field label={tk("description")} htmlFor="et-desc" className="sm:col-span-2"><Textarea id="et-desc" name="description" defaultValue={task.description ?? ""} rows={3} /></Field>
        <Field label={tk("priority")} htmlFor="et-prio"><NativeSelect id="et-prio" name="priorityId" defaultValue={task.priorityId ?? ""}><option value="">—</option>{priorities.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</NativeSelect></Field>
        <Field label={tk("dueDate")} htmlFor="et-due" error={fe.dueDate}><Input id="et-due" name="dueDate" type="datetime-local" defaultValue={toLocalInput(task.dueDate)} /></Field>
        <Field label={tk("startDate")} htmlFor="et-start"><Input id="et-start" name="startDate" type="datetime-local" defaultValue={toLocalInput(task.startDate)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          {task.perm.canSetRequired
            ? <input type="checkbox" name="isRequired" defaultChecked={task.isRequired} className="size-4 accent-primary" />
            : <><input type="hidden" name="isRequired" value={task.isRequired ? "true" : "false"} /><input type="checkbox" checked={task.isRequired} disabled className="size-4" readOnly /></>}
          {tk("required")}
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending}>{tk("save")}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpenEdit(false)}>{tk("close")}</Button>
        </div>
      </form>
    </section>
  );
}

function TaskUploader({ taskId }: { taskId: string }) {
  const tk = useTranslations("tasks");
  const [state, action, pending] = useActionState(uploadTaskAttachmentsAction, null);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="taskId" value={taskId} />
      <div className="flex items-center gap-2">
        <input name="attachments" type="file" multiple className="text-sm file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1 file:text-sm" aria-label={tk("taskFiles")} />
        <Button size="sm" variant="secondary" type="submit" disabled={pending}>{tk("upload")}</Button>
      </div>
      {state && !state.ok && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

export function statusLabel(s: TaskStatus) {
  return TASK_STATUS_LABEL[s];
}
