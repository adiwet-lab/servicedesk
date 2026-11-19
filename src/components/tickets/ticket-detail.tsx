import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, Download, FileText, History, ListChecks, Lock, MessageSquare, Paperclip, Trash2, UserCheck,
} from "lucide-react";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { NotFoundError } from "@/server/authz/errors";
import { getTicketDetail } from "@/server/services/tickets";
import { getSettings } from "@/server/services/settings";
import { getTicketTasks } from "@/server/services/tasks";
import { getTicketEditOptions } from "@/server/services/ticket-updates";
import { getChatPermissions, listMessages, unreadCounts } from "@/server/services/messages";
import { ChatTabBadge, TicketChat } from "@/components/chat/ticket-chat";
import { TicketLiveRefresh } from "@/components/realtime/realtime-provider";
import { TaskPanel } from "@/components/tasks/task-panel";
import { EditTicketDialog, EscalateDialog, TeamsCard, TimelineView } from "./ticket-extra";
import { removeAttachmentAction, takeOwnershipAction } from "@/server/actions/tickets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAging, formatBytes, formatDateTime } from "@/lib/utils";
import { PriorityBadge, StatusBadge } from "./badges";
import { SlaCard } from "./sla-card";
import { AssignDialog, AttachmentUploader, StatusChanger } from "./ticket-actions";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? "—"}</dd>
    </div>
  );
}

export async function TicketDetail({ actor, idOrNumber, backHref, created, initialTab }: { actor: Actor; idOrNumber: string; backHref: string; created?: boolean; initialTab?: string }) {
  let detail;
  try {
    detail = await getTicketDetail(actor, decodeURIComponent(idOrNumber));
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { ticket: t, permissions: perm, allowedTransitions, blockingTasks } = detail;
  const [settings, taskData, chatPerms, chatInitial, chatUnread] = await Promise.all([
    getSettings(prisma), getTicketTasks(actor, t), getChatPermissions(actor, t.id), listMessages(actor, t.id), unreadCounts(actor, [t.id]),
  ]);
  // Options are needed by anyone who can edit, escalate, manage teams/tasks or (re)assign/edit any visible task.
  const needsOptions = perm.canEdit || perm.canEscalate || perm.canManageTasks || perm.canManageSupportingTeams
    || taskData.tasks.some((task) => task.perm.canAssignOthers || task.perm.canWork);
  const editOptions = needsOptions ? await getTicketEditOptions() : null;
  const [teams, agents] = perm.canAssign
    ? await Promise.all([
        prisma.supportTeam.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        t.ownerTeamId
          ? prisma.user.findMany({ where: { status: "ACTIVE", deletedAt: null, teamMemberships: { some: { teamId: t.ownerTeamId } } }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } })
          : Promise.resolve([]),
      ])
    : [[], []];
  const closed = ["CLOSED", "CANCELLED"].includes(t.status.kind);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back</Link>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-primary" data-testid="ticket-number">{t.number}</span>
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            {t.isConfidential && <Badge variant="warning"><Lock className="size-3" /> Confidential</Badge>}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{t.subject}</h1>
          <p className="text-sm text-muted-foreground">Opened {formatDateTime(t.createdAt)} by {t.createdBy.displayName} · aging {formatAging(t.createdAt, t.closedAt ?? t.resolvedAt ?? new Date())}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {perm.canAssign && t.assignedAgentId !== actor.id && !closed && t.ownerTeamId && actor.teamIds.includes(t.ownerTeamId) && (
            <form action={takeOwnershipAction}>
              <input type="hidden" name="ticketId" value={t.id} />
              <Button variant="outline" type="submit"><UserCheck /> Assign to me</Button>
            </form>
          )}
          {perm.canAssign && !closed && (
            <AssignDialog ticketId={t.id} teams={teams} currentTeamId={t.ownerTeamId} currentAgentId={t.assignedAgentId} canTransfer={perm.canTransfer} initialAgents={agents} />
          )}
          {perm.canEdit && editOptions && <EditTicketDialog ticket={t} options={editOptions} />}
          {perm.canEscalate && editOptions && <EscalateDialog ticketId={t.id} currentPriorityLevel={t.priority.level} currentTeamId={t.ownerTeamId} options={editOptions} />}
          <StatusChanger ticketId={t.id} transitions={allowedTransitions} blockingTasks={blockingTasks} />
        </div>
      </div>

      {created && <Alert variant="success">Ticket <strong>{t.number}</strong> was created and routed to <strong>{t.ownerTeam?.name ?? "the service desk"}</strong>.</Alert>}
      {t.status.kind === "WAITING" && t.waitingReason && <Alert variant="warning"><strong>{t.status.name}:</strong> {t.waitingReason}</Alert>}
      {t.resolutionSummary && ["RESOLVED", "CLOSED"].includes(t.status.kind) && (
        <Alert variant="success"><strong className="flex items-center gap-1"><CheckCircle2 className="size-4" /> Resolution</strong><p className="mt-1 whitespace-pre-wrap">{t.resolutionSummary}</p></Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed">{t.description}</p></CardContent>
          </Card>

          <TicketLiveRefresh ticketId={t.id} />
          <Tabs defaultValue={initialTab === "tasks" || initialTab === "chat" ? initialTab : "timeline"}>
            <TabsList>
              <TabsTrigger value="timeline"><History className="size-4" /> Timeline</TabsTrigger>
              <TabsTrigger value="tasks" data-testid="tab-tasks"><ListChecks className="size-4" /> Tasks ({taskData.progress.total})</TabsTrigger>
              <TabsTrigger value="attachments"><Paperclip className="size-4" /> Attachments ({t.attachments.length})</TabsTrigger>
              <TabsTrigger value="chat" data-testid="tab-chat"><MessageSquare className="size-4" /> Chat <ChatTabBadge ticketId={t.id} initial={chatUnread[t.id] ?? 0} /></TabsTrigger>
            </TabsList>
            <TabsContent value="timeline">
              <TimelineView items={detail.timeline} />
            </TabsContent>
            <TabsContent value="tasks">
              <TaskPanel ticketId={t.id} tasks={taskData.tasks} progress={taskData.progress} hiddenCount={taskData.hiddenCount}
                canCreate={perm.canManageTasks} readOnly={false}
                teams={editOptions?.teams ?? []} priorities={editOptions?.priorities ?? []} defaultTeamId={t.ownerTeamId} />
            </TabsContent>
            <TabsContent value="attachments">
              <Card>
                <CardContent className="space-y-4 pt-5">
                  {t.attachments.length === 0 && <p className="text-sm text-muted-foreground">No attachments.</p>}
                  <ul className="divide-y">
                    {t.attachments.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 py-2">
                        <FileText className="size-5 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <a href={`/api/attachments/${a.id}`} className="block truncate text-sm font-medium hover:underline">{a.fileName}</a>
                          <p className="text-xs text-muted-foreground">{formatBytes(a.sizeBytes)} · {a.uploadedBy.displayName} · {formatDateTime(a.createdAt)}</p>
                        </div>
                        <Button asChild variant="ghost" size="icon"><a href={`/api/attachments/${a.id}`} aria-label="Download"><Download /></a></Button>
                        {!closed && (a.uploadedById === actor.id || perm.canWork) && (
                          <form action={removeAttachmentAction}>
                            <input type="hidden" name="attachmentId" value={a.id} />
                            <Button variant="ghost" size="icon" type="submit" aria-label="Remove attachment"><Trash2 className="text-destructive" /></Button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                  {perm.canUpload && <AttachmentUploader ticketId={t.id} allowed={settings["attachments.allowedExtensions"]} />}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="chat">
              <TicketChat ticketId={t.id} perms={chatPerms} initial={chatInitial}
                maxFileSizeMb={settings["attachments.maxFileSizeMb"]} allowedExtensions={settings["attachments.allowedExtensions"]} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Ticket information</CardTitle></CardHeader>
            <CardContent>
              <dl>
                <Row label="Status"><StatusBadge status={t.status} /></Row>
                <Row label="Priority"><PriorityBadge priority={t.priority} /></Row>
                <Row label="Category">{t.category.name}{t.subcategory ? ` › ${t.subcategory.name}` : ""}</Row>
                <Row label="Owner team">{t.ownerTeam?.name}</Row>
                <Row label="Assigned agent">{t.assignedAgent?.displayName ?? <span className="text-muted-foreground">Unassigned</span>}</Row>
                <Row label="Company">{t.company?.name}</Row>
                <Row label="Branch">{t.branch?.name}</Row>
                <Row label="Location">{t.location?.name}</Row>
                <Row label="Related asset">{t.relatedAsset}</Row>
                <Row label="Affected system">{t.affectedSystem}</Row>
                <Row label="Affected users">{t.affectedUsers}</Row>
                <Row label="Last updated">{formatDateTime(t.updatedAt)}</Row>
              </dl>
            </CardContent>
          </Card>
          <TeamsCard ticketId={t.id} owner={t.ownerTeam ? { id: t.ownerTeam.id, name: t.ownerTeam.name } : null} agent={t.assignedAgent?.displayName ?? null}
            supporting={t.supportingTeams.map((s) => s.team)} openTasksByTeam={detail.openTasksByTeam} canManage={perm.canManageSupportingTeams}
            teams={editOptions?.teams ?? []} />
          <SlaCard ticketId={t.id} />
          <Card>
            <CardHeader><CardTitle className="text-base">Requester</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar name={t.requester.displayName} className="size-10" />
                <div className="min-w-0">
                  <p className="font-medium">{t.requester.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.requester.email}</p>
                </div>
              </div>
              <dl>
                <Row label="Employee ID">{t.requester.employeeId}</Row>
                <Row label="Job title">{t.requester.jobTitle}</Row>
                <Row label="Department">{t.requester.department?.name}</Row>
                <Row label="Contact">{t.contactNumber}</Row>
              </dl>
            </CardContent>
          </Card>
          {t.assignments.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Assignment history</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm">
                  {t.assignments.map((a) => (
                    <li key={a.id} className="border-l-2 pl-3">
                      <p><Badge variant="secondary">{a.type}</Badge> {a.prevTeam?.name && a.prevTeam.name !== a.newTeam?.name ? `${a.prevTeam.name} → ` : ""}{a.newTeam?.name}</p>
                      <p className="text-xs text-muted-foreground">Agent: {a.prevAgent?.displayName ?? "—"} → {a.newAgent?.displayName ?? "—"}</p>
                      {a.reason && <p className="text-xs">“{a.reason}”</p>}
                      <p className="text-xs text-muted-foreground">{a.changedBy?.displayName ?? "System"} · {formatDateTime(a.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
