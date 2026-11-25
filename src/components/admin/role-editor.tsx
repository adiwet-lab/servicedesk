"use client";
import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { saveRoleAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { useTranslations } from "next-intl";

export interface PermissionOpt { code: string; group: string; description: string | null }
export interface RoleData { id: string; code: string; name: string; description: string | null; defaultTicketVisibility: string; permissions: string[]; isSystem: boolean }

export function RoleEditor({ role, permissions }: { role: RoleData | null; permissions: PermissionOpt[] }) {
  const tsys = useTranslations("sysadm");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveRoleAction.bind(null, role?.id ?? null), null);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const groups = [...new Set(permissions.map((p) => p.group))];
  return (
    <>
      {role ? <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Pencil /> {tsys("edit")}</Button> : <Button onClick={() => setOpen(true)}><Plus /> {tsys("newRole")}</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{role ? tsys("editRole", { name: role.name }) : tsys("newRole")}</DialogTitle>
            <DialogDescription>{tsys("youCanOnlyGrantPermissionsYou")}</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              {!role && <Field label={tsys("code")} htmlFor="code" required><Input id="code" name="code" required placeholder={tsys("eGHelpdeskL1")} /></Field>}
              <Field label={tsys("name")} htmlFor="name" required><Input id="name" name="name" defaultValue={role?.name} required /></Field>
              <Field label={tsys("defaultTicketVisibilityForNewUsers")} htmlFor="defaultTicketVisibility">
                <NativeSelect id="defaultTicketVisibility" name="defaultTicketVisibility" defaultValue={role?.defaultTicketVisibility ?? "OWN"}>
                  <option value="OWN">{tsys("own")}</option><option value="OWN_DEPT">{tsys("ownDepartment")}</option><option value="OWN_BRANCH">{tsys("ownBranch")}</option><option value="OWN_DEPT_BRANCH">{tsys("ownDepartmentBranch")}</option>
                </NativeSelect>
              </Field>
              <Field label={tsys("description")} htmlFor="description" className="sm:col-span-2"><Textarea id="description" name="description" defaultValue={role?.description ?? ""} rows={2} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map((g) => (
                <fieldset key={g} className="rounded-md border p-3">
                  <legend className="px-1 text-sm font-semibold">{g}</legend>
                  {permissions.filter((p) => p.group === g).map((p) => (
                    <label key={p.code} className="flex items-start gap-2 py-0.5 text-sm">
                      <input type="checkbox" name="permissions" value={p.code} defaultChecked={role?.permissions.includes(p.code)} className="mt-0.5 accent-primary" />
                      <span><code className="text-xs">{p.code}</code><span className="block text-xs text-muted-foreground">{p.description}</span></span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tsys("cancel")}</Button>
              <Button type="submit" disabled={pending}>{tsys("saveRole")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
