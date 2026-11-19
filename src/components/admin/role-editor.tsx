"use client";
import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { saveRoleAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";

export interface PermissionOpt { code: string; group: string; description: string | null }
export interface RoleData { id: string; code: string; name: string; description: string | null; defaultTicketVisibility: string; permissions: string[]; isSystem: boolean }

export function RoleEditor({ role, permissions }: { role: RoleData | null; permissions: PermissionOpt[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveRoleAction.bind(null, role?.id ?? null), null);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const groups = [...new Set(permissions.map((p) => p.group))];
  return (
    <>
      {role ? <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Pencil /> Edit</Button> : <Button onClick={() => setOpen(true)}><Plus /> New role</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{role ? `Edit role: ${role.name}` : "New role"}</DialogTitle>
            <DialogDescription>You can only grant permissions you hold yourself. Changes apply on the next request of affected users.</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              {!role && <Field label="Code" htmlFor="code" required><Input id="code" name="code" required placeholder="e.g. HELPDESK_L1" /></Field>}
              <Field label="Name" htmlFor="name" required><Input id="name" name="name" defaultValue={role?.name} required /></Field>
              <Field label="Default ticket visibility (for new users)" htmlFor="defaultTicketVisibility">
                <NativeSelect id="defaultTicketVisibility" name="defaultTicketVisibility" defaultValue={role?.defaultTicketVisibility ?? "OWN"}>
                  <option value="OWN">Own</option><option value="OWN_DEPT">Own + Department</option><option value="OWN_BRANCH">Own + Branch</option><option value="OWN_DEPT_BRANCH">Own + Department + Branch</option>
                </NativeSelect>
              </Field>
              <Field label="Description" htmlFor="description" className="sm:col-span-2"><Textarea id="description" name="description" defaultValue={role?.description ?? ""} rows={2} /></Field>
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
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>Save role</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
