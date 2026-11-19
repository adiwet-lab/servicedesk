"use client";
import { useActionState, useMemo, useState } from "react";
import { Paperclip, Send } from "lucide-react";
import { createTicketAction } from "@/server/actions/tickets";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface Cat { id: string; name: string; requiredFields: string[]; defaultPriorityId: string | null }
interface Props {
  categories: (Cat & { children: Cat[] })[];
  priorities: { id: string; code: string; name: string }[];
  branches: { id: string; name: string; locations: { id: string; name: string }[] }[];
  canSetPriority: boolean;
  defaults: { branchId: string | null; contactNumber: string | null; requester: string; department: string | null; company: string | null };
  maxFileSizeMb: number;
  maxFiles: number;
  allowedExtensions: string[];
}

export function CreateTicketForm(p: Props) {
  const [state, action, pending] = useActionState(createTicketAction, null);
  const [catId, setCatId] = useState("");
  const [subId, setSubId] = useState("");
  const [branchId, setBranchId] = useState(p.defaults.branchId ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const cat = p.categories.find((c) => c.id === catId);
  const sub = cat?.children.find((s) => s.id === subId);
  const required = useMemo(() => new Set([...(cat?.requiredFields ?? []), ...(sub?.requiredFields ?? [])]), [cat, sub]);
  const locations = p.branches.find((b) => b.id === branchId)?.locations ?? [];
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const defaultPriority = sub?.defaultPriorityId ?? cat?.defaultPriorityId ?? "";
  const tooBig = files.find((f) => f.size > p.maxFileSizeMb * 1024 * 1024);

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
        <Card>
          <CardHeader>
            <CardTitle>What do you need help with?</CardTitle>
            <CardDescription>Choose a category so your request is routed to the right support team automatically.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Main category" htmlFor="categoryId" required error={fe.categoryId}>
              <NativeSelect id="categoryId" name="categoryId" value={catId} onChange={(e) => { setCatId(e.target.value); setSubId(""); }} aria-invalid={!!fe.categoryId} required>
                <option value="">Select…</option>
                {p.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Subcategory" htmlFor="subcategoryId" required={!!cat?.children.length} error={fe.subcategoryId}>
              <NativeSelect id="subcategoryId" name="subcategoryId" value={subId} onChange={(e) => setSubId(e.target.value)} disabled={!cat?.children.length} aria-invalid={!!fe.subcategoryId} required={!!cat?.children.length}>
                <option value="">{cat ? "Select…" : "Choose a main category first"}</option>
                {cat?.children.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Subject" htmlFor="subject" required error={fe.subject} className="sm:col-span-2">
              <Input id="subject" name="subject" maxLength={200} placeholder="Short summary, e.g. “POS terminal 3 cannot print receipts”" aria-invalid={!!fe.subject} required />
            </Field>
            <Field label="Description" htmlFor="description" required error={fe.description} className="sm:col-span-2" hint="Include what happened, when it started, error messages and what you already tried.">
              <Textarea id="description" name="description" rows={7} maxLength={20000} aria-invalid={!!fe.description} required />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Fields marked * are required for the selected category.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Related asset" htmlFor="relatedAsset" required={required.has("relatedAsset")} error={fe.relatedAsset} hint="Asset tag / serial number">
              <Input id="relatedAsset" name="relatedAsset" maxLength={100} required={required.has("relatedAsset")} aria-invalid={!!fe.relatedAsset} />
            </Field>
            <Field label="Affected system" htmlFor="affectedSystem" required={required.has("affectedSystem")} error={fe.affectedSystem}>
              <Input id="affectedSystem" name="affectedSystem" maxLength={200} required={required.has("affectedSystem")} aria-invalid={!!fe.affectedSystem} />
            </Field>
            <Field label="Affected users" htmlFor="affectedUsers" required={required.has("affectedUsers")} error={fe.affectedUsers} className="sm:col-span-2" hint="Who else is impacted? e.g. “All cashiers at Siam store”">
              <Input id="affectedUsers" name="affectedUsers" maxLength={500} required={required.has("affectedUsers")} aria-invalid={!!fe.affectedUsers} />
            </Field>
            <Field label="Contact number" htmlFor="contactNumber" required={required.has("contactNumber")} error={fe.contactNumber}>
              <Input id="contactNumber" name="contactNumber" maxLength={50} defaultValue={p.defaults.contactNumber ?? ""} required={required.has("contactNumber")} aria-invalid={!!fe.contactNumber} />
            </Field>
            <Field label="Priority" htmlFor="priorityId" error={fe.priorityId} hint={p.canSetPriority ? "Leave empty to use the category default" : "Set by the support team"}>
              <NativeSelect id="priorityId" name="priorityId" key={defaultPriority} defaultValue={defaultPriority} disabled={!p.canSetPriority}>
                <option value="">Default</option>
                {p.priorities.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} – {pr.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Branch" htmlFor="branchId" error={fe.branchId}>
              <NativeSelect id="branchId" name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">—</option>
                {p.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Location" htmlFor="locationId" required={required.has("locationId")} error={fe.locationId}>
              <NativeSelect id="locationId" name="locationId" disabled={!locations.length} required={required.has("locationId")}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Attachments" htmlFor="attachments" required={required.has("attachments")} error={fe.attachments ?? (tooBig ? `"${tooBig.name}" exceeds ${p.maxFileSizeMb} MB` : undefined)} className="sm:col-span-2"
              hint={`Up to ${p.maxFiles} files, max ${p.maxFileSizeMb} MB each. Allowed: ${p.allowedExtensions.join(", ")}`}>
              <label htmlFor="attachments" className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground hover:bg-accent/50">
                <Paperclip className="size-4" />
                {files.length ? files.map((f) => f.name).join(", ") : "Click to choose files (screenshots, logs, documents)"}
              </label>
              <input id="attachments" name="attachments" type="file" multiple className="sr-only" accept={p.allowedExtensions.map((e) => `.${e}`).join(",")}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))} required={required.has("attachments")} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="isConfidential" className="size-4 accent-primary" />
              Confidential — only me, the assigned agent and the owning support team can see this ticket
            </label>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Requester</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{p.defaults.requester}</p>
            <p className="text-muted-foreground">{p.defaults.department ?? "No department"}</p>
            <p className="text-muted-foreground">{p.defaults.company ?? ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm text-muted-foreground">
            <p>Your ticket number is generated automatically and the ticket is routed to the responsible team based on the category.</p>
            <Button type="submit" size="lg" className="w-full" disabled={pending || !!tooBig} data-testid="submit-ticket">
              <Send /> {pending ? "Submitting…" : "Submit ticket"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
