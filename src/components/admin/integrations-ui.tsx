"use client";
import { useActionState, useState, useTransition } from "react";
import { Copy, RefreshCw, Search, Send } from "lucide-react";
import {
  assetConfigAction, createTokenAction, graphIntervalAction, graphSyncNowAction, teamsEventsAction, teamWebhookAction, testAssetAction, testTeamWebhookAction,
} from "@/server/actions/integrations";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";

type R = { ok: boolean; error?: string; message?: string } | null;
const Msg = ({ s }: { s: R }) => (s ? <p className={s.ok ? "text-xs text-success" : "text-xs text-destructive"}>{s.ok ? s.message : s.error}</p> : null);

export function GraphSyncNow({ tenantId, disabled }: { tenantId: string; disabled: boolean }) {
  const [s, a, pending] = useActionState(graphSyncNowAction, null);
  return (
    <form action={a} className="space-y-1">
      <input type="hidden" name="tenantId" value={tenantId} />
      <Button size="sm" variant="outline" type="submit" disabled={pending || disabled} data-testid={`graph-sync-${tenantId}`}><RefreshCw className={pending ? "animate-spin" : ""} /> Sync now</Button>
      <Msg s={s} />
    </form>
  );
}

export function GraphInterval({ hours }: { hours: number }) {
  const [s, a, pending] = useActionState(graphIntervalAction, null);
  return (
    <form action={a} className="flex flex-wrap items-end gap-2">
      <Field label="Automatic sync every (hours, 0 = manual)" htmlFor="graph-hours"><Input id="graph-hours" name="hours" type="number" min={0} max={168} defaultValue={hours} className="w-28" /></Field>
      <Button size="sm" type="submit" variant="outline" disabled={pending}>Save</Button>
      <Msg s={s} />
    </form>
  );
}

export function TeamWebhookForm({ teamId, teamName, current }: { teamId: string; teamName: string; current: string | null }) {
  const [s, a, pending] = useActionState(teamWebhookAction, null);
  const [t, ta, tpending] = useActionState(testTeamWebhookAction, null);
  return (
    <div className="space-y-1">
      <form action={a} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="teamId" value={teamId} />
        <Input name="url" type="url" placeholder={current ?? "https://….webhook.office.com/… or Workflows URL"} className="min-w-64 flex-1" aria-label={`Teams webhook for ${teamName}`} data-testid={`webhook-${teamId}`} />
        <Button size="sm" type="submit" disabled={pending}>Save</Button>
        {current && <Button size="sm" type="submit" name="clear" value="true" variant="ghost" disabled={pending}>Remove</Button>}
      </form>
      {current && (
        <form action={ta}><input type="hidden" name="teamId" value={teamId} />
          <Button size="sm" variant="outline" type="submit" disabled={tpending}><Send /> Send test card</Button></form>
      )}
      <Msg s={s} /><Msg s={t} />
    </div>
  );
}

export function TeamsEventsForm({ all, enabled }: { all: Record<string, string>; enabled: string[] }) {
  const [s, a, pending] = useActionState(teamsEventsAction, null);
  return (
    <form action={a} className="space-y-2">
      {Object.entries(all).map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="events" value={k} defaultChecked={enabled.includes(k)} className="size-4 accent-primary" /> {label}</label>
      ))}
      <Button size="sm" type="submit" variant="outline" disabled={pending}>Save events</Button>
      <Msg s={s} />
    </form>
  );
}

export function AssetConfigForm({ cfg }: { cfg: { provider: string; baseUrl: string; lookupPath: string; mapping: Record<string, string>; apiKeySet: boolean } }) {
  const [s, a, pending] = useActionState(assetConfigAction, null);
  const [provider, setProvider] = useState(cfg.provider);
  const [tag, setTag] = useState("POS-BKK01-03");
  const [test, setTest] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="space-y-4">
      <form action={a} className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider" htmlFor="as-provider">
          <NativeSelect id="as-provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value)} data-testid="asset-provider">
            <option value="none">Disabled</option><option value="demo">Demo data (built-in)</option><option value="rest">REST API (Snipe-IT compatible)</option>
          </NativeSelect>
        </Field>
        {provider === "rest" && (
          <>
            <Field label="Base URL" htmlFor="as-url" hint="Host must be listed in INTEGRATIONS_ALLOWED_HOSTS"><Input id="as-url" name="baseUrl" defaultValue={cfg.baseUrl} placeholder="https://assets.contoso.example" /></Field>
            <Field label="Lookup path" htmlFor="as-path"><Input id="as-path" name="lookupPath" defaultValue={cfg.lookupPath} /></Field>
            <Field label={`API key ${cfg.apiKeySet ? "(set — leave blank to keep)" : ""}`} htmlFor="as-key"><Input id="as-key" name="apiKey" type="password" autoComplete="off" /></Field>
            <Field label="Field mapping (JSON dot-paths)" htmlFor="as-map" className="sm:col-span-2"><Textarea id="as-map" name="mapping" rows={4} defaultValue={JSON.stringify(cfg.mapping, null, 1)} className="font-mono text-xs" /></Field>
            {cfg.apiKeySet && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clearApiKey" className="size-4 accent-primary" /> Remove stored API key</label>}
          </>
        )}
        <div className="sm:col-span-2"><Button size="sm" type="submit" disabled={pending} data-testid="save-assets">Save</Button> <Msg s={s} /></div>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={tag} onChange={(e) => setTag(e.target.value)} className="w-48" aria-label="Asset tag to test" />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
          const r = await testAssetAction(tag);
          setTest(r.error ? `Error: ${r.error}` : r.asset ? `${r.asset.tag}: ${r.asset.model ?? r.asset.name ?? ""} · ${r.asset.status ?? ""}` : r.provider ? "Not found" : "Asset lookup is disabled");
        })} data-testid="test-asset"><Search /> Test lookup</Button>
        {test && <span className="text-sm" data-testid="asset-test-result">{test}</span>}
      </div>
    </div>
  );
}

export function CreateTokenForm() {
  const [s, a, pending] = useActionState(createTokenAction, null);
  return (
    <form action={a} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Name" htmlFor="tok-name"><Input id="tok-name" name="name" placeholder="Power BI – IT KPI report" required minLength={3} className="w-64" /></Field>
        <Field label="Expires in (days)" htmlFor="tok-exp"><Input id="tok-exp" name="expiresInDays" type="number" min={1} max={730} defaultValue={365} className="w-28" /></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="includeNames" className="size-4 accent-primary" /> Include names &amp; subjects</label>
        <Button type="submit" size="sm" disabled={pending} data-testid="create-token">Create token</Button>
      </div>
      {s && !s.ok && <Alert variant="destructive">{s.error}</Alert>}
      {s?.ok && "data" in s && s.data && (
        <Alert variant="success">
          <p className="font-medium">{s.message}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="break-all rounded bg-background px-2 py-1 font-mono text-xs" data-testid="new-token">{s.data.token}</code>
            <Button type="button" size="icon" variant="ghost" aria-label="Copy token" onClick={() => navigator.clipboard?.writeText(s.data!.token)}><Copy /></Button>
          </div>
        </Alert>
      )}
    </form>
  );
}
