"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTransitionAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { ColorBadge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface Status { id: string; name: string; color: string; kind: string; isActive: boolean }
interface Transition { fromStatusId: string; toStatusId: string; requiredPermission: string; requesterAllowed: boolean; requiresComment: boolean }

export function WorkflowMatrix({ statuses, transitions, permissionCodes }: { statuses: Status[]; transitions: Transition[]; permissionCodes: string[] }) {
  const tcfg = useTranslations("cfg");
  const router = useRouter();
  const [edit, setEdit] = useState<{ from: Status; to: Status; t: Transition | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const find = (f: string, t: string) => transitions.find((x) => x.fromStatusId === f && x.toStatusId === t) ?? null;

  function save(fd: FormData, enabled: boolean) {
    if (!edit) return;
    start(async () => {
      const r = await saveTransitionAction({
        fromStatusId: edit.from.id, toStatusId: edit.to.id, enabled,
        requiredPermission: String(fd.get("requiredPermission") ?? "ticket.update"),
        requesterAllowed: fd.get("requesterAllowed") === "on", requiresComment: fd.get("requiresComment") === "on",
      });
      if (r.ok) { setEdit(null); setErr(null); router.refresh(); } else setErr(r.error);
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card p-3 text-left text-xs uppercase text-muted-foreground">{tcfg("fromTo")}</th>
            {statuses.map((s) => <th key={s.id} className="p-2 text-center"><ColorBadge color={s.color}>{s.name}</ColorBadge></th>)}
          </tr>
        </thead>
        <tbody>
          {statuses.map((from) => (
            <tr key={from.id} className="border-t">
              <th className="sticky left-0 bg-card p-3 text-left"><ColorBadge color={from.color}>{from.name}</ColorBadge></th>
              {statuses.map((to) => {
                const t = find(from.id, to.id);
                if (from.id === to.id) return <td key={to.id} className="bg-muted/40" />;
                return (
                  <td key={to.id} className="p-1 text-center">
                    <button onClick={() => setEdit({ from, to, t })} title={t ? `${t.requiredPermission}${t.requesterAllowed ? " · requester" : ""}` : tcfg("notAllowed")}
                      className={cn("h-8 w-full min-w-12 rounded-md text-xs font-medium", t ? "bg-success/15 text-success hover:bg-success/25" : "text-muted-foreground/40 hover:bg-accent")}>
                      {t ? (t.requesterAllowed ? tcfg("requesterToo") : "✓") : "·"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t p-3 text-xs text-muted-foreground">{tcfg("matrixLegend")}</p>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit?.from.name} → {edit?.to.name}</DialogTitle>
            <DialogDescription>{tcfg("configureWhetherThisStatusChangeIs")}</DialogDescription>
          </DialogHeader>
          <form action={(fd) => save(fd, true)} className="space-y-4" key={`${edit?.from.id}-${edit?.to.id}`}>
            {err && <Alert variant="destructive">{err}</Alert>}
            <Field label={tcfg("requiredPermissionSupportStaff")} htmlFor="requiredPermission">
              <NativeSelect id="requiredPermission" name="requiredPermission" defaultValue={edit?.t?.requiredPermission ?? "ticket.update"}>
                {permissionCodes.map((c) => <option key={c} value={c}>{c}</option>)}
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requesterAllowed" defaultChecked={edit?.t?.requesterAllowed} className="accent-primary" /> {tcfg("requesterMayPerformThisTransition")}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requiresComment" defaultChecked={edit?.t?.requiresComment} className="accent-primary" /> {tcfg("requireAComment")}</label>
            <DialogFooter>
              {edit?.t && <Button type="button" variant="destructive" disabled={pending} onClick={() => save(new FormData(), false)}>{tcfg("removeTransition")}</Button>}
              <Button type="submit" disabled={pending}>{edit?.t ? tcfg("save") : tcfg("allowTransition")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
