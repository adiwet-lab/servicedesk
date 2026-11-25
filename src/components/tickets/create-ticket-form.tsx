"use client";
import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Paperclip, Send } from "lucide-react";
import { createTicketAction } from "@/server/actions/tickets";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ImpactFields } from "@/components/incidents/incident-forms";
import { SuggestedArticles } from "@/components/kb/kb-client";
import { AssetInput } from "./asset-check";

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
  const t = useTranslations("createTicket");
  const [state, action, pending] = useActionState(createTicketAction, null);
  const [catId, setCatId] = useState("");
  const [subId, setSubId] = useState("");
  const [branchId, setBranchId] = useState(p.defaults.branchId ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [subject, setSubject] = useState("");
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
            <CardTitle>{t("helpTitle")}</CardTitle>
            <CardDescription>{t("helpDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t("mainCategory")} htmlFor="categoryId" required error={fe.categoryId}>
              <NativeSelect id="categoryId" name="categoryId" value={catId} onChange={(e) => { setCatId(e.target.value); setSubId(""); }} aria-invalid={!!fe.categoryId} required>
                <option value="">{t("select")}</option>
                {p.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("subcategory")} htmlFor="subcategoryId" required={!!cat?.children.length} error={fe.subcategoryId}>
              <NativeSelect id="subcategoryId" name="subcategoryId" value={subId} onChange={(e) => setSubId(e.target.value)} disabled={!cat?.children.length} aria-invalid={!!fe.subcategoryId} required={!!cat?.children.length}>
                <option value="">{cat ? t("select") : t("chooseMainFirst")}</option>
                {cat?.children.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("subject")} htmlFor="subject" required error={fe.subject} className="sm:col-span-2">
              <Input id="subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder={t("subjectPlaceholder")} aria-invalid={!!fe.subject} required />
            </Field>
            <Field label={t("description")} htmlFor="description" required error={fe.description} className="sm:col-span-2" hint={t("descriptionHint")}>
              <Textarea id="description" name="description" rows={7} maxLength={20000} aria-invalid={!!fe.description} required />
            </Field>
          </CardContent>
        </Card>

        <SuggestedArticles text={subject} categoryId={subId || catId} />
        <Card>
          <CardHeader>
            <CardTitle>{t("details")}</CardTitle>
            <CardDescription>{t("detailsHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t("relatedAsset")} htmlFor="relatedAsset" required={required.has("relatedAsset")} error={fe.relatedAsset} hint={t("relatedAssetHint")}>
              <AssetInput required={required.has("relatedAsset")} invalid={!!fe.relatedAsset} />
            </Field>
            <Field label={t("affectedSystem")} htmlFor="affectedSystem" required={required.has("affectedSystem")} error={fe.affectedSystem}>
              <Input id="affectedSystem" name="affectedSystem" maxLength={200} required={required.has("affectedSystem")} aria-invalid={!!fe.affectedSystem} />
            </Field>
            <Field label={t("affectedUsers")} htmlFor="affectedUsers" required={required.has("affectedUsers")} error={fe.affectedUsers} className="sm:col-span-2" hint={t("affectedUsersHint")}>
              <Input id="affectedUsers" name="affectedUsers" maxLength={500} required={required.has("affectedUsers")} aria-invalid={!!fe.affectedUsers} />
            </Field>
            <Field label={t("contactNumber")} htmlFor="contactNumber" required={required.has("contactNumber")} error={fe.contactNumber}>
              <Input id="contactNumber" name="contactNumber" maxLength={50} defaultValue={p.defaults.contactNumber ?? ""} required={required.has("contactNumber")} aria-invalid={!!fe.contactNumber} />
            </Field>
            <Field label={t("priority")} htmlFor="priorityId" error={fe.priorityId} hint={p.canSetPriority ? t("priorityHintCan") : t("priorityHintCannot")}>
              <NativeSelect id="priorityId" name="priorityId" key={defaultPriority} defaultValue={defaultPriority} disabled={!p.canSetPriority}>
                <option value="">{t("default")}</option>
                {p.priorities.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} – {pr.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("branch")} htmlFor="branchId" error={fe.branchId}>
              <NativeSelect id="branchId" name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">—</option>
                {p.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("location")} htmlFor="locationId" required={required.has("locationId")} error={fe.locationId}>
              <NativeSelect id="locationId" name="locationId" disabled={!locations.length} required={required.has("locationId")}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("attachments")} htmlFor="attachments" required={required.has("attachments")} error={fe.attachments ?? (tooBig ? t("fileTooBig", { name: tooBig.name, mb: p.maxFileSizeMb }) : undefined)} className="sm:col-span-2"
              hint={t("attachHint", { max: p.maxFiles, mb: p.maxFileSizeMb, types: p.allowedExtensions.join(", ") })}>
              <label htmlFor="attachments" className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground hover:bg-accent/50">
                <Paperclip className="size-4" />
                {files.length ? files.map((f) => f.name).join(", ") : t("chooseFiles")}
              </label>
              <input id="attachments" name="attachments" type="file" multiple className="sr-only" accept={p.allowedExtensions.map((e) => `.${e}`).join(",")}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))} required={required.has("attachments")} />
            </Field>
            <div className="sm:col-span-2">
              <ImpactFields branches={p.branches} branchField="impactBranchIds" optional />
              {fe.impactScope && <p className="mt-1 text-sm text-destructive">{fe.impactScope}</p>}
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="isConfidential" className="size-4 accent-primary" />
              {t("confidential")}
            </label>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>{t("requester")}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{p.defaults.requester}</p>
            <p className="text-muted-foreground">{p.defaults.department ?? t("noDepartment")}</p>
            <p className="text-muted-foreground">{p.defaults.company ?? ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm text-muted-foreground">
            <p>{t("numberInfo")}</p>
            <Button type="submit" size="lg" className="w-full" disabled={pending || !!tooBig} data-testid="submit-ticket">
              <Send /> {pending ? t("submitting") : t("submit")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
