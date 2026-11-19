import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { AuthorizationError } from "@/server/authz/errors";
import { getIntegrationsOverview } from "@/server/services/admin/integrations";
import { retryOutboxAction, revokeTokenAction, toggleGraphSyncAction } from "@/server/actions/integrations";
import { AssetConfigForm, CreateTokenForm, GraphInterval, GraphSyncNow, TeamsEventsForm, TeamWebhookForm } from "@/components/admin/integrations-ui";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Integrations" };

type SyncResult = { fetched?: number; created?: number; updated?: number; linked?: number; deactivated?: number; managerLinks?: number; unmappedDepartments?: string[]; error?: string };

export default async function IntegrationsPage() {
  const actor = await requireAdminPortal();
  let d;
  try { d = await getIntegrationsOverview(actor); } catch (e) { if (e instanceof AuthorizationError) notFound(); throw e; }
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <div className="space-y-5">
      <PageHeader title="Integrations" description="Microsoft Graph directory sync, Microsoft Teams channel cards, IT asset lookup and Power BI feeds." />

      <Card data-testid="int-graph">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">Microsoft Graph — directory sync
            <Badge variant={d.graph.configured ? "success" : "secondary"} data-testid="graph-status">{d.graph.configured ? "Configured" : "Not configured"}</Badge></CardTitle>
          <CardDescription>App-only access (application permission <code>User.Read.All</code>, admin consent per tenant). Updates names, job titles, employee IDs, departments and managers; deactivates disabled accounts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <GraphInterval hours={d.graph.intervalHours} />
          <Table className="text-sm">
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Tenant</TableHead><TableHead>Sync</TableHead><TableHead>Last sync</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {d.graph.tenants.map((t) => {
                const res = t.lastGraphSyncResult as SyncResult | null;
                return (
                  <TableRow key={t.id}>
                    <TableCell><p className="font-medium">{t.name} <Badge variant="outline">{t.type}</Badge></p><p className="font-mono text-xs text-muted-foreground">{t.entraTenantId}</p></TableCell>
                    <TableCell>
                      <form action={toggleGraphSyncAction}>
                        <input type="hidden" name="tenantId" value={t.id} /><input type="hidden" name="enabled" value={t.graphSyncEnabled ? "false" : "true"} />
                        <Button size="sm" variant={t.graphSyncEnabled ? "default" : "outline"} type="submit">{t.graphSyncEnabled ? "Enabled" : "Disabled"}</Button>
                      </form>
                    </TableCell>
                    <TableCell className="max-w-80 text-xs">
                      {t.lastGraphSyncAt ? <>
                        <p>{formatDateTime(t.lastGraphSyncAt)}</p>
                        {res?.error ? <p className="text-destructive">{res.error}</p> : res && <p className="text-muted-foreground">{res.fetched} fetched · {res.created} created · {res.updated} updated · {res.linked} linked · {res.deactivated} deactivated · {res.managerLinks} manager links</p>}
                        {!!res?.unmappedDepartments?.length && <p className="text-amber-700 dark:text-amber-300">Unmapped departments: {res.unmappedDepartments.join(", ")}</p>}
                      </> : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell><GraphSyncNow tenantId={t.id} disabled={!d.graph.configured} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="int-teams">
        <CardHeader>
          <CardTitle className="text-base">Microsoft Teams — channel cards</CardTitle>
          <CardDescription>Adaptive Cards are posted to a team&apos;s channel through an incoming webhook or a Teams Workflows (“Post to a channel when a webhook request is received”) URL. URLs are stored encrypted; cards never contain descriptions, chat or internal notes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-3">
          <div><p className="mb-2 text-sm font-medium">Events</p><TeamsEventsForm all={d.teams.allEvents} enabled={d.teams.events} /></div>
          <div className="space-y-3 lg:col-span-2">
            {d.teams.teams.map((t) => (
              <div key={t.id} className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">{t.name} {t.webhook ? <Badge variant="success">Connected · {t.webhook}</Badge> : <Badge variant="secondary">No webhook</Badge>}</p>
                <TeamWebhookForm teamId={t.id} teamName={t.name} current={t.webhook} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="int-assets">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">IT asset management <Badge variant={d.assets.provider === "none" ? "secondary" : "success"} data-testid="asset-status">{d.assets.provider === "none" ? "Disabled" : d.assets.provider === "demo" ? "Demo data" : "REST API"}</Badge></CardTitle>
          <CardDescription>Looks up the ticket&apos;s “Related asset” tag (model, serial, assigned user, location, warranty). Snipe-IT compatible by default; field mapping is configurable.</CardDescription>
        </CardHeader>
        <CardContent><AssetConfigForm cfg={d.assets} /></CardContent>
      </Card>

      <Card data-testid="int-bi">
        <CardHeader>
          <CardTitle className="text-base">Power BI — reporting feeds</CardTitle>
          <CardDescription>
            Read-only JSON feeds at <code>{appUrl}/api/bi/v1/&#123;feed&#125;</code> — tickets, tasks, sla-events, teams, categories, priorities, statuses, branches, departments.
            Paging with <code>$top</code> (max 5000) / <code>$skip</code>, incremental refresh with <code>modifiedSince</code>. People are pseudonymous unless the token includes names. Descriptions, chat and notes are never exported.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreateTokenForm />
          <Table className="text-sm" data-testid="token-table">
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Name</TableHead><TableHead>Token</TableHead><TableHead>Names</TableHead><TableHead>Expires</TableHead><TableHead>Last used</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {d.tokens.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No tokens yet.</TableCell></TableRow>}
              {d.tokens.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.name}<p className="text-xs text-muted-foreground">{t.createdBy.displayName} · {formatDateTime(t.createdAt)}</p></TableCell>
                  <TableCell className="font-mono text-xs">{t.prefix}…</TableCell>
                  <TableCell>{t.includeNames ? "Yes" : "Pseudonymous"}</TableCell>
                  <TableCell className="text-xs">{t.expiresAt ? formatDateTime(t.expiresAt) : "—"}</TableCell>
                  <TableCell className="text-xs">{t.lastUsedAt ? formatDateTime(t.lastUsedAt) : "Never"}</TableCell>
                  <TableCell>{t.revokedAt ? <Badge variant="secondary">Revoked</Badge> : (
                    <form action={revokeTokenAction}><input type="hidden" name="tokenId" value={t.id} /><Button size="sm" variant="ghost" type="submit" className="text-destructive">Revoke</Button></form>
                  )}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="int-outbox">
        <CardHeader>
          <CardTitle className="text-base">Delivery log</CardTitle>
          <CardDescription>
            {["PENDING", "SENT", "FAILED", "DEAD"].map((s) => `${s.toLowerCase()}: ${d.outboxCounts[s] ?? 0}`).join(" · ")} — failed deliveries retry with exponential backoff (6 attempts); 4xx errors stop immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="text-sm">
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>When</TableHead><TableHead>Event</TableHead><TableHead>Target</TableHead><TableHead>Status</TableHead><TableHead>Error</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {d.outbox.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nothing sent yet.</TableCell></TableRow>}
              {d.outbox.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(o.createdAt)}</TableCell>
                  <TableCell>{o.channel} · {o.event}</TableCell>
                  <TableCell>{o.targetName}</TableCell>
                  <TableCell><Badge variant={o.status === "SENT" ? "success" : o.status === "DEAD" ? "destructive" : "warning"}>{o.status}</Badge> <span className="text-xs text-muted-foreground">×{o.attempts}</span></TableCell>
                  <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={o.lastError ?? ""}>{o.lastError}</TableCell>
                  <TableCell>{(o.status === "FAILED" || o.status === "DEAD") && (
                    <form action={retryOutboxAction}><input type="hidden" name="id" value={o.id} /><Button size="sm" variant="ghost" type="submit">Retry</Button></form>
                  )}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
