import Link from "next/link";
import { notFound } from "next/navigation";
import { Siren } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { AuthorizationError } from "@/server/authz/errors";
import { listMajorIncidents } from "@/server/services/incidents";
import { MiStatusBadge } from "@/components/incidents/incident-panel";
import { KpiCard } from "@/components/dashboard/kpi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ColorBadge } from "@/components/ui/badge";

import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/i18n/server";
import { currentLocale } from "@/i18n/server";
import { ln } from "@/lib/localized";

export const generateMetadata = pageTitle("majorIncidents");

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ recent?: string }> }) {
  const tim = await getTranslations("impact");
  const locale = await currentLocale();
  const tinc = await getTranslations("inc");
  const fmt = await getFormat();
  const actor = await requireAdminPortal();
  const sp = await searchParams;
  const includeResolved = sp.recent === "1";
  let data;
  try { data = await listMajorIncidents(actor, { includeResolved }); } catch (e) { if (e instanceof AuthorizationError) notFound(); throw e; }
  const active = data.rows.filter((r) => r.majorIncidentStatus !== "RESOLVED");
  const now = new Date();
  return (
    <div className="space-y-5">
      <PageHeader title={tinc("majorIncidents")} description={tinc("activeMajorIncidentsImpactedBranchesAnd")}
        actions={<Link className="text-sm text-primary hover:underline" href={includeResolved ? "/admin/incidents" : "/admin/incidents?recent=1"}>{includeResolved ? tinc("activeOnly") : tinc("includeResolved30Days")}</Link>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={tinc("activeMajorIncidents")} value={active.length} tone={active.length ? "danger" : undefined} color="#ef4444" />
        <KpiCard label={tinc("linkedTickets")} value={active.reduce((n, r) => n + r._count.childTickets, 0)} color="#3b82f6" />
        <KpiCard label={tinc("impactedBranches")} value={data.impactedBranches.length} color="#f59e0b" />
        <KpiCard label={tinc("slaBreached")} value={active.filter((r) => r.resolutionBreached).length} color="#a855f7" />
      </div>
      <div className="grid gap-5 xl:grid-cols-4">
        <Card className="xl:col-span-3">
          <CardHeader><CardTitle className="text-base">{tinc("incidents")}</CardTitle></CardHeader>
          <CardContent>
            {data.rows.length === 0 ? <EmptyState icon={<Siren />} title={tinc("noMajorIncidents")} description={tinc("declareOneFromATicketS")} /> : (
              <Table className="text-sm" data-testid="incident-table">
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead>{tinc("incident")}</TableHead><TableHead>{tinc("status")}</TableHead><TableHead>{tinc("impact")}</TableHead><TableHead className="text-right">{tinc("linked")}</TableHead>
                  <TableHead>{tinc("age")}</TableHead><TableHead>{tinc("slaDue")}</TableHead><TableHead>{tinc("lastUpdate")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-72">
                        <Link className="font-mono text-xs font-medium text-primary hover:underline" href={`/admin/tickets/${r.number}`}>{r.number}</Link>{" "}
                        <ColorBadge color={r.priority.color}>{r.priority.code}</ColorBadge>
                        <p className="truncate">{r.subject}</p>
                        <p className="text-xs text-muted-foreground">{r.ownerTeam?.name ?? "—"} · {r.assignedAgent?.displayName ?? tinc("unassigned")}</p>
                      </TableCell>
                      <TableCell>{r.majorIncidentStatus && <MiStatusBadge status={r.majorIncidentStatus} />}</TableCell>
                      <TableCell className="max-w-56">
                        <p>{r.impactScope ? tim(r.impactScope) : "—"}{r.impactedUserCount ? tinc("approxUsers", { n: r.impactedUserCount }) : ""}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.impactedBranches.map((b) => ln(b.branch, locale)).join(", ")}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r._count.childTickets}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.majorDeclaredAt ? fmt.aging(r.majorDeclaredAt, now) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.resolutionBreached ? <span className="text-destructive">{tinc("breached")}</span> : r.slaPausedAt ? tinc("paused") : r.resolutionDueAt ? fmt.dateTime(r.resolutionDueAt) : "—"}</TableCell>
                      <TableCell className="max-w-64"><p className="line-clamp-2">{r.incidentUpdates[0]?.message ?? "—"}</p>
                        {r.incidentUpdates[0] && <p className="text-xs text-muted-foreground">{fmt.dateTime(r.incidentUpdates[0].createdAt)}</p>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{tinc("impactedBranches")}</CardTitle></CardHeader>
          <CardContent>
            {data.impactedBranches.length === 0 ? <p className="text-sm text-muted-foreground">{tinc("noBranchesImpactedByActiveIncidents")}</p> : (
              <ul className="space-y-1 text-sm" data-testid="impacted-branches">
                {data.impactedBranches.map((b) => <li key={b.name} className="flex justify-between"><span>{b.name}</span><span className="tabular-nums text-muted-foreground">{b.count}</span></li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
