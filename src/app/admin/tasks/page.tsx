import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ListChecks, Search } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { isVendor } from "@/server/authz/actor";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { TASK_VIEWS, availableTaskViews, listTasks, taskListQuerySchema, type TaskView } from "@/server/services/tasks";
import { TASK_STATUSES, TASK_STATUS_LABEL, isTaskOverdue } from "@/server/domain/task-workflow";
import { Card } from "@/components/ui/card";
import { Badge, ColorBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TaskStatusBadge } from "@/components/tasks/task-badges";
import { cn, formatAging, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Tasks" };

const TITLES: Record<TaskView, [string, string]> = {
  my: ["My Tasks", "Tasks assigned to you across all tickets."],
  team: ["Team Tasks", "Tasks owned by your support teams."],
  all: ["All Tasks", "Every task in the system."],
  overdue: ["Overdue Tasks", "Open tasks past their due date (within your scope)."],
};

type Params = Record<string, string | undefined>;
const qs = (params: Params, patch: Params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) sp.set(k, v);
  return `/admin/tasks?${sp}`;
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requireAdminPortal();
  const params = await searchParams;
  const view = ((TASK_VIEWS as readonly string[]).includes(params.view ?? "") ? params.view : "my") as TaskView;
  if (!availableTaskViews(actor).has(view)) notFound();
  const q = taskListQuerySchema.parse(params);
  const [res, teams, priorities] = await Promise.all([
    listTasks(actor, view, q),
    prisma.supportTeam.findMany({
      where: { isActive: true, deletedAt: null, ...(can(actor, P.TICKET_READ_ALL) && !isVendor(actor) ? {} : { id: { in: actor.teamIds } }) },
      orderBy: { name: "asc" },
    }),
    prisma.priority.findMany({ where: { isActive: true }, orderBy: { level: "asc" } }),
  ]);
  const [title, desc] = TITLES[view];
  const now = new Date();
  const base = { ...params, view };
  const sortHead = (label: string, field: string) => {
    const active = q.sort === field;
    const next = active && q.dir === "asc" ? "desc" : "asc";
    return (
      <TableHead><Link href={qs(base, { sort: field, dir: next, page: undefined })} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}{active && (q.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</Link></TableHead>
    );
  };

  return (
    <div>
      <PageHeader title={title} description={desc} />
      <Card className="overflow-hidden">
        <form method="get" action="/admin/tasks" className="flex flex-wrap items-end gap-2 border-b p-3">
          <input type="hidden" name="view" value={view} />
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={params.q} placeholder="Task no., title, ticket no. or subject" className="pl-9" aria-label="Search tasks" />
          </div>
          <NativeSelect name="status" defaultValue={params.status ?? ""} className="w-40" aria-label="Status">
            <option value="">All statuses</option><option value="ACTIVE">Active (not done)</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </NativeSelect>
          <NativeSelect name="team" defaultValue={params.team ?? ""} className="w-44" aria-label="Team">
            <option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
          <NativeSelect name="priority" defaultValue={params.priority ?? ""} className="w-36" aria-label="Priority">
            <option value="">All priorities</option>{priorities.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </NativeSelect>
          <NativeSelect name="required" defaultValue={params.required ?? ""} className="w-36" aria-label="Required">
            <option value="">Required & optional</option><option value="yes">Required</option><option value="no">Optional</option>
          </NativeSelect>
          <Button type="submit" variant="secondary">Apply</Button>
          <Button asChild variant="ghost"><Link href={`/admin/tasks?view=${view}`}>Reset</Link></Button>
        </form>
        {res.rows.length === 0 ? (
          <EmptyState icon={<ListChecks />} title="No tasks found" description="Nothing matches the current view and filters." />
        ) : (
          <Table data-testid="tasks-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {sortHead("Task", "number")}{sortHead("Title", "title")}<TableHead>Ticket</TableHead><TableHead>Team / Agent</TableHead>
                <TableHead>Priority</TableHead>{sortHead("Status", "status")}{sortHead("Due", "dueDate")}<TableHead>Type</TableHead>{sortHead("Aging", "createdAt")}
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.rows.map((t) => {
                const overdue = isTaskOverdue(t, now);
                const href = `/admin/tickets/${t.ticket.number}?task=${t.number}`;
                return (
                  <TableRow key={t.id} className={cn(overdue && "bg-destructive/5")}>
                    <TableCell className="font-mono text-xs whitespace-nowrap"><Link href={href} className="font-semibold text-primary hover:underline">{t.number}</Link></TableCell>
                    <TableCell className="max-w-72"><Link href={href} className="font-medium hover:underline">{t.title}</Link></TableCell>
                    <TableCell className="text-xs"><Link href={`/admin/tickets/${t.ticket.number}`} className="font-mono text-primary hover:underline">{t.ticket.number}</Link>
                      <div className="max-w-56 truncate text-muted-foreground">{t.ticket.subject}</div></TableCell>
                    <TableCell className="text-xs whitespace-nowrap"><div>{t.team?.name ?? "—"}</div><div className="text-muted-foreground">{t.assignedAgent?.displayName ?? "Unassigned"}</div></TableCell>
                    <TableCell>{t.priority ? <ColorBadge color={t.priority.color}>{t.priority.code}</ColorBadge> : "—"}</TableCell>
                    <TableCell><TaskStatusBadge status={t.status} /></TableCell>
                    <TableCell className={cn("text-xs whitespace-nowrap", overdue && "font-semibold text-destructive")}>{t.dueDate ? formatDateTime(t.dueDate) : "—"}{overdue && <Badge variant="destructive" className="ml-1">Overdue</Badge>}</TableCell>
                    <TableCell>{t.isRequired ? <Badge>Required</Badge> : <Badge variant="outline">Optional</Badge>}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatAging(t.createdAt, t.completedAt ?? now)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t px-3 py-3 text-sm text-muted-foreground">
          <span>{res.total} task{res.total === 1 ? "" : "s"} · page {res.page} of {res.pages}</span>
          <div className="flex gap-1">
            {res.page > 1 && <Link className="rounded-md border p-1.5 hover:bg-accent" href={qs(base, { page: String(res.page - 1) })} aria-label="Previous page"><ChevronLeft className="size-4" /></Link>}
            {res.page < res.pages && <Link className="rounded-md border p-1.5 hover:bg-accent" href={qs(base, { page: String(res.page + 1) })} aria-label="Next page"><ChevronRight className="size-4" /></Link>}
          </div>
        </div>
      </Card>
    </div>
  );
}
