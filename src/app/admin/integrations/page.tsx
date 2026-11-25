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

import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/i18n/server";

export const generateMetadata = pageTitle("integrations");

type SyncResult = { fetched?: number; created?: number; updated?: number; linked?: number; deactivated?: number; managerLinks?: number; unmappedDepartments?: string[]; error?: string };

export default async function IntegrationsPage() {
  const tinteg = await getTranslations("integ");
  const fmt = await getFormat();
  const actor = await requireAdminPortal();
  let d;
  try { d = await getIntegrationsOverview(actor); } catch (e) { if (e instanceof AuthorizationError) notFound(); throw e; }
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <div className="space-y-5">
      <PageHeader title={tinteg("integrations")} description={tinteg("microsoftGraphDirectorySyncMicrosoftTeams")} />

      <Card data-testid="int-graph">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">{tinteg("microsoftGraphDirectorySync")}
            <Badge variant={d.graph.configured ? "success" : "secondary"} data-testid="graph-status">{d.graph.configured ? tinteg("configured") : tinteg("notConfigured")}</Badge></CardTitle>
          <CardDescription>{tinteg.rich("graphDesc", { code: (c) => <code>{c}</code> })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <GraphInterval hours={d.graph.intervalHours} />
          <Table className="text-sm">
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{tinteg("tenant")}</TableHead><TableHead>{tinteg("sync")}</TableHead><TableHead>{tinteg("lastSync")}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {d.graph.tenants.map((t) => {
                const res = t.lastGraphSyncResult as SyncResult | null;
                return (
                  <TableRow key={t.id}>
                    <TableCell><p className="font-medium">{t.name} <Badge variant="outline">{t.type}</Badge></p><p className="font-mono text-xs text-muted-foreground">{t.entraTenantId}</p></TableCell>
                    <TableCell>
                      <form action={toggleGraphSyncAction}>
                        <input type="hidden" name="tenantId" value={t.id} /><input type="hidden" name="enabled" value={t.graphSyncEnabled ? "false" : "true"} />
                        <Button size="sm" variant={t.graphSyncEnabled ? "default" : "outline"} type="submit">{t.graphSyncEnabled ? tinteg("enabled") : tinteg("disabled")}</Button>
                      </form>
                    </TableCell>
                    <TableCell className="max-w-80 text-xs">
                      {t.lastGraphSyncAt ? <>
                        <p>{fmt.dateTime(t.lastGraphSyncAt)}</p>
                        {res?.error ? <p className="text-destructive">{res.error}</p> : res && <p className="text-muted-foreground">{tinteg("syncResult", { fetched: res.fetched ?? 0, created: res.created ?? 0, updated: res.updated ?? 0, linked: res.linked ?? 0, deactivated: res.deactivated ?? 0, managerLinks: res.managerLinks ?? 0 })}</p>}
                        {!!res?.unmappedDepartments?.length && <p className="text-amber-700 dark:text-amber-300">{tinteg("unmappedDepts", { list: res.unmappedDepartments.join(", ") })}</p>}
                      </> : <span className="text-muted-foreground">{tinteg("never")}</span>}
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
          <CardTitle className="text-base">{tinteg("microsoftTeamsChannelCards")}</CardTitle>
          <CardDescription>{tinteg("teamsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-3">
          <div><p className="mb-2 text-sm font-medium">{tinteg("events")}</p><TeamsEventsForm all={d.teams.allEvents} enabled={d.teams.events} /></div>
          <div className="space-y-3 lg:col-span-2">
            {d.teams.teams.map((t) => (
              <div key={t.id} className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">{t.name} {t.webhook ? <Badge variant="success">{tinteg("connectedTo", { host: t.webhook })}</Badge> : <Badge variant="secondary">{tinteg("noWebhook")}</Badge>}</p>
                <TeamWebhookForm teamId={t.id} teamName={t.name} current={t.webhook} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="int-assets">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">{tinteg("itAssetManagement")} <Badge variant={d.assets.provider === "none" ? "secondary" : "success"} data-testid="asset-status">{d.assets.provider === "none" ? tinteg("disabled") : d.assets.provider === "demo" ? tinteg("demoData") : tinteg("restApi")}</Badge></CardTitle>
          <CardDescription>{tinteg("assetDesc")}</CardDescription>
        </CardHeader>
        <CardContent><AssetConfigForm cfg={d.assets} /></CardContent>
      </Card>

      <Card data-testid="int-bi">
        <CardHeader>
          <CardTitle className="text-base">{tinteg("powerBiReportingFeeds")}</CardTitle>
          <CardDescription>
            {tinteg.rich("biDesc1", { url: `${appUrl}/api/bi/v1/{feed}`, code: (c) => <code>{c}</code> })}
            {tinteg.rich("biDesc2", { code: (c) => <code>{c}</code> })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreateTokenForm />
          <Table className="text-sm" data-testid="token-table">
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{tinteg("name")}</TableHead><TableHead>{tinteg("token")}</TableHead><TableHead>{tinteg("names")}</TableHead><TableHead>{tinteg("expires")}</TableHead><TableHead>{tinteg("lastUsed")}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {d.tokens.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{tinteg("noTokensYet")}</TableCell></TableRow>}
              {d.tokens.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.name}<p className="text-xs text-muted-foreground">{t.createdBy.displayName} · {fmt.dateTime(t.createdAt)}</p></TableCell>
                  <TableCell className="font-mono text-xs">{t.prefix}…</TableCell>
                  <TableCell>{t.includeNames ? tinteg("yes") : tinteg("pseudonymous")}</TableCell>
                  <TableCell className="text-xs">{t.expiresAt ? fmt.dateTime(t.expiresAt) : "—"}</TableCell>
                  <TableCell className="text-xs">{t.lastUsedAt ? fmt.dateTime(t.lastUsedAt) : tinteg("never")}</TableCell>
                  <TableCell>{t.revokedAt ? <Badge variant="secondary">{tinteg("revoked")}</Badge> : (
                    <form action={revokeTokenAction}><input type="hidden" name="tokenId" value={t.id} /><Button size="sm" variant="ghost" type="submit" className="text-destructive">{tinteg("revoke")}</Button></form>
                  )}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="int-outbox">
        <CardHeader>
          <CardTitle className="text-base">{tinteg("deliveryLog")}</CardTitle>
          <CardDescription>
            {["PENDING", "SENT", "FAILED", "DEAD"].map((s) => `${s.toLowerCase()}: ${d.outboxCounts[s] ?? 0}`).join(" · ")} {tinteg("outboxNote")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="text-sm">
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{tinteg("when")}</TableHead><TableHead>{tinteg("event")}</TableHead><TableHead>{tinteg("target")}</TableHead><TableHead>{tinteg("status")}</TableHead><TableHead>{tinteg("error")}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {d.outbox.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{tinteg("nothingSentYet")}</TableCell></TableRow>}
              {d.outbox.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmt.dateTime(o.createdAt)}</TableCell>
                  <TableCell>{o.channel} · {o.event}</TableCell>
                  <TableCell>{o.targetName}</TableCell>
                  <TableCell><Badge variant={o.status === "SENT" ? "success" : o.status === "DEAD" ? "destructive" : "warning"}>{o.status}</Badge> <span className="text-xs text-muted-foreground">×{o.attempts}</span></TableCell>
                  <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={o.lastError ?? ""}>{o.lastError}</TableCell>
                  <TableCell>{(o.status === "FAILED" || o.status === "DEAD") && (
                    <form action={retryOutboxAction}><input type="hidden" name="id" value={o.id} /><Button size="sm" variant="ghost" type="submit">{tinteg("retry")}</Button></form>
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
