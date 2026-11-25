"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Power, Search } from "lucide-react";
import { saveCrudAction, setCrudActiveAction } from "@/server/actions/admin";
import type { ColumnDef, CrudRow, FieldDef } from "@/server/services/admin/crud";
import { Button } from "@/components/ui/button";
import { Badge, ColorBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export function CrudTable({ entity, singular, fields, columns, rows, canToggle, rowLink }: {
  entity: string; singular: string; fields: FieldDef[]; columns: ColumnDef[]; rows: CrudRow[]; canToggle: boolean;
  rowLink?: { label: string; hrefPrefix: string };
}) {
  const tcfg = useTranslations("cfg");
  const router = useRouter();
  const [editing, setEditing] = useState<CrudRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(true);

  const filtered = useMemo(() => rows.filter((r) =>
    (showInactive || r.isActive) && (!q || Object.values(r.cells).some((v) => String(v ?? "").toLowerCase().includes(q.toLowerCase())))), [rows, q, showInactive]);
  const isNew = editing === "new";
  const values = editing && editing !== "new" ? editing.values : {};
  const multi = fields.filter((f) => f.type === "multiselect").map((f) => f.name);

  function close() { setEditing(null); setError(null); setFieldErrors({}); }

  function submit(fd: FormData) {
    start(async () => {
      const res = await saveCrudAction(entity, isNew ? null : (editing as CrudRow).id, multi, fd);
      if (res.ok) { close(); router.refresh(); }
      else { setError(res.error); setFieldErrors(res.fieldErrors ?? {}); }
    });
  }
  function toggle(r: CrudRow) {
    start(async () => {
      const res = await setCrudActiveAction(entity, r.id, !r.isActive);
      if (!res.ok) alert(res.error);
      router.refresh();
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tcfg("filter")} className="pl-9" aria-label={tcfg("filter_")} />
        </div>
        {canToggle && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-primary" /> {tcfg("showInactive")}
          </label>
        )}
        <Button onClick={() => setEditing("new")} data-testid="crud-add"><Plus /> {tcfg("addThing", { thing: singular.toLowerCase() })}</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}
            {canToggle && <TableHead>{tcfg("status")}</TableHead>}
            <TableHead className="text-right">{tcfg("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && <TableRow><TableCell colSpan={columns.length + 2} className="py-10 text-center text-muted-foreground">{tcfg("noRecords")}</TableCell></TableRow>}
          {filtered.map((r) => (
            <TableRow key={r.id} className={cn(!r.isActive && "opacity-60")}>
              {columns.map((c) => {
                const v = r.cells[c.key];
                return (
                  <TableCell key={c.key} className={cn(c.kind === "mono" && "font-mono text-xs")}>
                    {c.kind === "color" ? <ColorBadge color={String(v)}>{String(v)}</ColorBadge>
                      : c.kind === "bool" ? (v ? <Badge variant="success">{tcfg("yes")}</Badge> : <span className="text-muted-foreground">{tcfg("no")}</span>)
                      : c.kind === "badge" ? <Badge variant="secondary">{String(v)}</Badge>
                      : String(v ?? "—")}
                  </TableCell>
                );
              })}
              {canToggle && <TableCell>{r.isActive ? <Badge variant="success">{tcfg("active")}</Badge> : <Badge variant="outline">{tcfg("inactive")}</Badge>}</TableCell>}
              <TableCell className="text-right whitespace-nowrap">
                {rowLink && <Button asChild variant="ghost" size="sm"><Link href={`${rowLink.hrefPrefix}${r.id}`}>{rowLink.label}</Link></Button>}
                <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={tcfg("edit")}><Pencil /> {tcfg("edit")}</Button>
                {canToggle && (
                  <Button variant="ghost" size="sm" onClick={() => toggle(r)} disabled={pending} aria-label={r.isActive ? tcfg("deactivate") : tcfg("activate")}>
                    <Power className={r.isActive ? "text-destructive" : "text-success"} /> {r.isActive ? tcfg("disable") : tcfg("enable")}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{isNew ? tcfg("addThing", { thing: singular.toLowerCase() }) : tcfg("editThing", { thing: singular.toLowerCase() })}</DialogTitle>
            <DialogDescription>{tcfg("changesAreRecordedInTheAudit")}</DialogDescription>
          </DialogHeader>
          <form action={submit} className="grid gap-4" key={isNew ? "new" : (editing as CrudRow | null)?.id}>
            {error && <Alert variant="destructive">{error}</Alert>}
            {fields.map((f) => {
              const disabled = !isNew && f.immutable;
              const v = values[f.name];
              const id = `f-${f.name}`;
              return (
                <Field key={f.name} label={f.label} htmlFor={id} required={f.required && !disabled} error={fieldErrors[f.name]} hint={f.hint}>
                  {f.type === "textarea" ? <Textarea id={id} name={f.name} defaultValue={String(v ?? "")} disabled={disabled} rows={3} />
                    : f.type === "select" ? (
                      <NativeSelect id={id} name={f.name} defaultValue={String(v ?? "")} disabled={disabled} required={f.required && !disabled}>
                        <option value="">—</option>
                        {groupOptions(f).map(([g, opts]) => g
                          ? <optgroup key={g} label={g}>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                          : opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>))}
                      </NativeSelect>
                    ) : f.type === "multiselect" ? (
                      <div className="grid grid-cols-2 gap-1.5 rounded-md border p-3">
                        {f.options?.map((o) => (
                          <label key={o.value} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name={f.name} value={o.value} defaultChecked={Array.isArray(v) && v.includes(o.value)} disabled={disabled} className="accent-primary" />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    ) : f.type === "checkbox" ? (
                      <label className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" name={f.name} defaultChecked={!!v} disabled={disabled} className="size-4 accent-primary" /> {tcfg("enabled")}</label>
                    ) : f.type === "color" ? (
                      <div className="flex items-center gap-2"><input type="color" name={f.name} defaultValue={String(v ?? "#3b82f6")} className="h-9 w-14 rounded border" id={id} /></div>
                    ) : (
                      <Input id={id} name={f.name} type={f.type === "number" ? "number" : "text"} defaultValue={v == null ? "" : String(v)} disabled={disabled}
                        required={f.required && !disabled} maxLength={f.max} placeholder={f.placeholder} />
                    )}
                </Field>
              );
            })}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>{tcfg("cancel")}</Button>
              <Button type="submit" disabled={pending} data-testid="crud-save">{pending ? tcfg("saving") : tcfg("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function groupOptions(f: FieldDef): [string | undefined, NonNullable<FieldDef["options"]>][] {
  const map = new Map<string | undefined, NonNullable<FieldDef["options"]>>();
  for (const o of f.options ?? []) {
    const arr = map.get(o.group) ?? [];
    arr.push(o);
    map.set(o.group, arr);
  }
  return [...map.entries()];
}
