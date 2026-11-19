import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { AuthorizationError } from "@/server/authz/errors";
import { getAccessReview } from "@/server/services/admin/access-review";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Access Review" };

type U = Awaited<ReturnType<typeof getAccessReview>>["expiring"][number];

function Users({ rows, empty, testid }: { rows: U[]; empty: string; testid: string }) {
  if (!rows.length) return <p className="py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table className="text-sm" data-testid={testid}>
      <TableHeader><TableRow className="hover:bg-transparent"><TableHead>User</TableHead><TableHead>Tenant</TableHead><TableHead>Roles</TableHead><TableHead>Last login</TableHead><TableHead>Access expires</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((u) => (
          <TableRow key={u.id}>
            <TableCell><Link href={`/admin/system/users/${u.id}`} className="font-medium text-primary hover:underline">{u.name}</Link><p className="text-xs text-muted-foreground">{u.email}</p></TableCell>
            <TableCell>{u.tenant} {u.tenantType === "VENDOR" && <Badge variant="warning">Vendor</Badge>}</TableCell>
            <TableCell className="max-w-64"><p>{u.roles.join(", ") || "—"}</p>{u.privileges.length > 0 && <p className="text-xs text-muted-foreground">{u.privileges.join(", ")}</p>}</TableCell>
            <TableCell className="whitespace-nowrap text-xs">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</TableCell>
            <TableCell className="whitespace-nowrap text-xs">{u.accessExpiresAt ? formatDateTime(u.accessExpiresAt) : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function AccessReviewPage() {
  const actor = await requireAdminPortal();
  let r;
  try { r = await getAccessReview(actor); } catch (e) { if (e instanceof AuthorizationError) notFound(); throw e; }
  return (
    <div className="space-y-5">
      <PageHeader title="Access Review" description={`Periodic review of who can access what. Generated ${formatDateTime(r.generatedAt)}.`}
        actions={<Button asChild variant="outline"><a href="/api/admin/access-review" data-testid="access-review-csv"><Download /> Export CSV</a></Button>} />
      <Card><CardHeader><CardTitle className="text-base">Expiring within {r.expiringDays} days ({r.expiring.length})</CardTitle>
        <CardDescription>The user and all user administrators are notified automatically once per expiry window.</CardDescription></CardHeader>
        <CardContent><Users rows={r.expiring} empty="No accounts expire soon." testid="ar-expiring" /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Expired but still active ({r.expired.length})</CardTitle>
        <CardDescription>Sign-in is already blocked; deactivate or extend to keep the directory clean.</CardDescription></CardHeader>
        <CardContent><Users rows={r.expired} empty="None." testid="ar-expired" /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">No sign-in for {r.inactiveDays} days ({r.inactive.length})</CardTitle></CardHeader>
        <CardContent><Users rows={r.inactive} empty="None." testid="ar-inactive" /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Privileged access ({r.privileged.length})</CardTitle>
        <CardDescription>Holders of user/role/tenant administration, integrations, audit or read-all permissions.</CardDescription></CardHeader>
        <CardContent><Users rows={r.privileged} empty="None." testid="ar-privileged" /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Active Power BI tokens ({r.tokens.length})</CardTitle></CardHeader>
        <CardContent>
          {r.tokens.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
            <ul className="space-y-1 text-sm">{r.tokens.map((t) => <li key={t.id}>{t.name} <span className="font-mono text-xs">{t.prefix}…</span> · {t.includeNames ? "includes names" : "pseudonymous"} · created by {t.createdBy.displayName} · last used {t.lastUsedAt ? formatDateTime(t.lastUsedAt) : "never"}</li>)}</ul>
          )}
        </CardContent></Card>
    </div>
  );
}
