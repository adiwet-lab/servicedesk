"use client";
import { useActionState } from "react";
import { saveSequenceAction, saveSettingsAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";

const ALL_EXT = ["jpg", "jpeg", "png", "pdf", "docx", "xlsx", "txt", "log"];

export function SettingsForm({ s, teams, priorities, statuses }: {
  s: Record<string, unknown>; teams: { code: string; name: string }[]; priorities: { code: string; name: string }[]; statuses: { code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveSettingsAction, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const exts = s["attachments.allowedExtensions"] as string[];
  return (
    <form action={action} className="space-y-5">
      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">Settings saved.</Alert>}
      <Card>
        <CardHeader><CardTitle className="text-base">Attachments</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Max file size (MB)" htmlFor="mfs" error={fe["attachments.maxFileSizeMb"]}><Input id="mfs" type="number" min={1} max={100} name="attachments.maxFileSizeMb" defaultValue={String(s["attachments.maxFileSizeMb"])} /></Field>
          <Field label="Max files per upload" htmlFor="mfu" error={fe["attachments.maxFilesPerUpload"]}><Input id="mfu" type="number" min={1} max={20} name="attachments.maxFilesPerUpload" defaultValue={String(s["attachments.maxFilesPerUpload"])} /></Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">Allowed file types</legend>
            <div className="flex flex-wrap gap-3">{ALL_EXT.map((e) => <label key={e} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="attachments.allowedExtensions" value={e} defaultChecked={exts.includes(e)} className="accent-primary" /> .{e}</label>)}</div>
            <p className="mt-1 text-xs text-muted-foreground">File content is verified against its type (magic bytes) on upload.</p>
          </fieldset>
          <Field label="Malware scanning" htmlFor="mscan" className="sm:col-span-2" hint="Defender: enable Microsoft Defender for Storage on-upload malware scanning for the attachment container (STORAGE_DRIVER=azure). New files are held until tagged “No threats found”; malicious files are never served." error={fe["attachments.malwareScan"]}>
            <NativeSelect id="mscan" name="attachments.malwareScan" defaultValue={String(s["attachments.malwareScan"] ?? "none")} data-testid="malware-scan">
              <option value="none">Off — upload validation only</option>
              <option value="defender">Microsoft Defender for Storage — hold files until clean</option>
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Tickets & workflow</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Reopen window (days after resolution)" htmlFor="rw" error={fe["tickets.reopenWindowDays"]}><Input id="rw" type="number" min={0} name="tickets.reopenWindowDays" defaultValue={String(s["tickets.reopenWindowDays"])} /></Field>
          <Field label="Auto-close resolved tickets after (days)" htmlFor="ac" hint="Scheduled job arrives in Phase 4" error={fe["tickets.autoCloseResolvedDays"]}><Input id="ac" type="number" min={0} name="tickets.autoCloseResolvedDays" defaultValue={String(s["tickets.autoCloseResolvedDays"])} /></Field>
          <Field label="Fallback team (no routing match)" htmlFor="fb">
            <NativeSelect id="fb" name="tickets.fallbackTeamCode" defaultValue={String(s["tickets.fallbackTeamCode"])}>{teams.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Default priority" htmlFor="dp">
            <NativeSelect id="dp" name="tickets.defaultPriorityCode" defaultValue={String(s["tickets.defaultPriorityCode"])}>{priorities.map((p) => <option key={p.code} value={p.code}>{p.code} {p.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Status applied on first agent assignment" htmlFor="as">
            <NativeSelect id="as" name="workflow.assignedStatusCode" defaultValue={String(s["workflow.assignedStatusCode"])}>{statuses.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</NativeSelect>
          </Field>
          <Field label="When the requester replies to a waiting ticket, move it to" htmlFor="rr">
            <NativeSelect id="rr" name="workflow.requesterReplyStatusCode" defaultValue={String(s["workflow.requesterReplyStatusCode"] ?? "")}>
              <option value="">Don&apos;t change status</option>{statuses.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="tickets.requesterCanSetPriority" defaultChecked={!!s["tickets.requesterCanSetPriority"]} className="accent-primary" /> Requesters may choose priority</label>
        </CardContent>
      </Card>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
    </form>
  );
}

export function SequenceForm({ seq }: { seq: { key: string; prefix: string; format: string; resetYearly: boolean; current: number } }) {
  const [state, action, pending] = useActionState(saveSequenceAction, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{seq.key === "TICKET" ? "Ticket number format" : "Task number format"}</CardTitle>
        <CardDescription>Tokens: {"{PREFIX} {YYYY} {YY} {MM} {SEQ:n}"} · current counter {seq.current}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="key" value={seq.key} />
          <Field label="Prefix" htmlFor={`p-${seq.key}`}><Input id={`p-${seq.key}`} name="prefix" defaultValue={seq.prefix} className="w-28" /></Field>
          <Field label="Format" htmlFor={`f-${seq.key}`}><Input id={`f-${seq.key}`} name="format" defaultValue={seq.format} className="w-64 font-mono" /></Field>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="resetYearly" defaultChecked={seq.resetYearly} className="accent-primary" /> Reset yearly</label>
          <Button type="submit" variant="secondary" disabled={pending}>Save</Button>
        </form>
        {state?.ok && <p className="mt-2 text-sm text-success">Saved. Next number: <code>{state.data}</code></p>}
        {state && !state.ok && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  );
}
