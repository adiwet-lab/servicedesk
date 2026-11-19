"use client";
import { useActionState, useState } from "react";
import { saveUserAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";

type Opt = { id: string; name: string };
export interface UserFormProps {
  userId: string | null;
  initial: Record<string, string | string[] | null>;
  tenants: (Opt & { type: string })[];
  companies: Opt[];
  departments: (Opt & { companyId: string })[];
  branches: (Opt & { companyId: string })[];
  locations: (Opt & { branchId: string })[];
  roles: (Opt & { description: string | null })[];
  managers: { id: string; displayName: string }[];
  vendor: boolean;
}

export function UserForm(p: UserFormProps) {
  const [state, action, pending] = useActionState(saveUserAction.bind(null, p.userId), null);
  const [companyId, setCompanyId] = useState(String(p.initial.companyId ?? ""));
  const [branchId, setBranchId] = useState(String(p.initial.branchId ?? ""));
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const roleIds = (p.initial.roleIds as string[]) ?? [];
  const v = (k: string) => String(p.initial[k] ?? "");

  return (
    <form action={action} className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
        {state?.ok && <Alert variant="success">Saved. Access changes take effect immediately.</Alert>}
        <Card>
          <CardHeader><CardTitle className="text-base">Identity</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {!p.userId && (
              <>
                <Field label="Microsoft tenant" htmlFor="tenantId" required error={fe.tenantId}>
                  <NativeSelect id="tenantId" name="tenantId" required defaultValue="">{[<option key="" value="">Select…</option>, ...p.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)]}</NativeSelect>
                </Field>
                <Field label="Email (UPN)" htmlFor="email" required error={fe.email} hint="Linked to the Microsoft account on first sign-in">
                  <Input id="email" name="email" type="email" required />
                </Field>
              </>
            )}
            <Field label="Display name" htmlFor="displayName" required error={fe.displayName}><Input id="displayName" name="displayName" defaultValue={v("displayName")} required /></Field>
            <Field label="Employee ID" htmlFor="employeeId" error={fe.employeeId}><Input id="employeeId" name="employeeId" defaultValue={v("employeeId")} /></Field>
            <Field label="Job title" htmlFor="jobTitle"><Input id="jobTitle" name="jobTitle" defaultValue={v("jobTitle")} /></Field>
            <Field label="Contact number" htmlFor="contactNumber"><Input id="contactNumber" name="contactNumber" defaultValue={v("contactNumber")} /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Organization</CardTitle><CardDescription>Departments and branches are independent — a department can span many locations.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Company" htmlFor="companyId">
              <NativeSelect id="companyId" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">—</option>{p.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Department" htmlFor="departmentId" error={fe.departmentId}>
              <NativeSelect id="departmentId" name="departmentId" defaultValue={v("departmentId")} key={`d-${companyId}`}>
                <option value="">—</option>{p.departments.filter((d) => !companyId || d.companyId === companyId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Branch" htmlFor="branchId">
              <NativeSelect id="branchId" name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">—</option>{p.branches.filter((b) => !companyId || b.companyId === companyId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Location" htmlFor="locationId" error={fe.locationId}>
              <NativeSelect id="locationId" name="locationId" defaultValue={v("locationId")} key={`l-${branchId}`}>
                <option value="">—</option>{p.locations.filter((l) => l.branchId === branchId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Manager" htmlFor="managerId" error={fe.managerId}>
              <NativeSelect id="managerId" name="managerId" defaultValue={v("managerId")}>
                <option value="">—</option>{p.managers.filter((m) => m.id !== p.userId).map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle className="text-base">Access</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Account status" htmlFor="status">
              <NativeSelect id="status" name="status" defaultValue={v("status") || "ACTIVE"} data-testid="user-status">
                <option value="ACTIVE">Active</option><option value="PENDING">Pending approval</option><option value="INACTIVE">Inactive (deactivated)</option>
              </NativeSelect>
            </Field>
            <Field label="Access expires" htmlFor="accessExpiresAt" hint={p.vendor ? "Recommended for external users" : "Optional"}>
              <Input id="accessExpiresAt" name="accessExpiresAt" type="date" defaultValue={v("accessExpiresAt")} />
            </Field>
            <Field label="Ticket visibility" htmlFor="ticketVisibility" hint={p.vendor ? "Not applicable to external users" : "Which colleagues' tickets this user can view"}>
              <NativeSelect id="ticketVisibility" name="ticketVisibility" defaultValue={v("ticketVisibility") || "OWN"}>
                <option value="OWN">Own tickets only</option><option value="OWN_DEPT">Own + Department</option><option value="OWN_BRANCH">Own + Branch</option><option value="OWN_DEPT_BRANCH">Own + Department + Branch</option>
              </NativeSelect>
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Roles</legend>
              {p.roles.map((r) => (
                <label key={r.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="roleIds" value={r.id} defaultChecked={roleIds.includes(r.id)} className="mt-0.5 accent-primary" />
                  <span><span className="font-medium">{r.name}</span>{r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}</span>
                </label>
              ))}
            </fieldset>
            <Button type="submit" className="w-full" disabled={pending} data-testid="save-user">{pending ? "Saving…" : "Save user"}</Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
