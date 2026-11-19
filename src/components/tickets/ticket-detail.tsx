import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, Clock, Download, FileText, History, ListChecks, Lock, MessageSquare, Paperclip, Trash2, UserCheck,
} from "lucide-react";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { NotFoundError } from "@/server/authz/errors";
import { getTicketDetail } from "@/server/services/tickets";
import { getSettings } from "@/server/services/settings";
import { removeAttachmentAction, takeOwnershipAction } from "@/server/actions/tickets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAging, formatBytes, formatDateTime } from "@/lib/utils";
import { PriorityBadge, SlaBadge, StatusBadge } from "./badges";
import { AssignDialog, AttachmentUploader, StatusChanger } from "./ticket-actions";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? "—"}</dd>
    </div>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  CREATED: "created the ticket", STATUS_CHANGED: "changed status", REOPENED: "reopened the ticket", TEAM_CHANGED: "transferred to team",
  AGENT_CHANGED: "changed assignee", ATTACHMENT_ADDED: "added attachment", ATTACHMENT_REMOVED: "removed attachment", FIELD_UPDATED: "updated",
};

export async function TicketDetail({ actor, idOrNumber, backHref, created }: { actor: Actor; idOrNumber: string; backHref: string; created?: boolean }) {
  let detail;
  try {
    detail = await getTicketDetail(actor, decodeURIComponent(idOrNumber));
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { ticket: t, permissions: perm, allowedTransitions } = detail;
  const settings = await getSettings(prisma);
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
          <StatusChanger ticketId={t.id} transitions={allowedTransitions} />
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

          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline"><History className="size-4" /> Timeline</TabsTrigger>
              <TabsTrigger value="attachments"><Paperclip className="size-4" /> Attachments ({t.attachments.length})</TabsTrigger>
              <TabsTrigger value="tasks"><ListChecks className="size-4" /> Tasks</TabsTrigger>
              <TabsTrigger value="chat"><MessageSquare className="size-4" /> Chat</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline">
              <Card>
                <CardContent className="pt-5">
                  <ol className="relative space-y-5 border-l pl-6" data-testid="timeline">
                    {t.history.map((h) => (
                      <li key={h.id} className="relative">
                        <span className="absolute -left-[31px] top-0.5 flex size-4 items-center justify-center rounded-full border-2 border-card bg-primary/70" />
                        <p className="text-sm">
                          <span className="font-medium">{h.actor?.displayName ?? "System"}</span>{" "}
                          <span className="text-muted-foreground">{HISTORY_LABEL[h.action] ?? h.action.toLowerCase()}</span>
                          {h.oldValue || h.newValue ? (
                            <span> {h.oldValue && <><span className="line-through decoration-muted-foreground/50">{h.oldValue}</span> → </>}<span className="font-medium">{h.newValue}</span></span>
                          ) : null}
                        </p>
                        {h.reason && <p className="mt-1 rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{h.reason}</p>}
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
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
            <TabsContent value="tasks">
              <Card><CardContent className="pt-5 text-sm text-muted-foreground">Sub-tasks across multiple support teams arrive in <Badge variant="secondary">Phase 2</Badge>. Required tasks will block resolution.</CardContent></Card>
            </TabsContent>
            <TabsContent value="chat">
              <Card><CardContent className="pt-5 text-sm text-muted-foreground">Real-time chat with public messages and internal notes arrives in <Badge variant="secondary">Phase 3</Badge>.</CardContent></Card>
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
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock className="size-4" /> SLA</CardTitle></CardHeader>
            <CardContent>
              <dl>
                <Row label="Profile">{t.slaProfile?.name}</Row>
                <Row label="State"><SlaBadge ticket={t} warningPercent={t.slaProfile?.warningPercent} /></Row>
                <Row label="Response due">{formatDateTime(t.responseDueAt)}</Row>
                <Row label="First response">{formatDateTime(t.firstResponseAt)}</Row>
                <Row label="Resolution due">{formatDateTime(t.resolutionDueAt)}</Row>
                <Row label="Resolved">{formatDateTime(t.resolvedAt)}</Row>
              </dl>
            </CardContent>
          </Card>
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
