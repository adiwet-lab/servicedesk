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

import { pageTitle } from "@/i18n/metadata";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/i18n/server";
import { makeFormat } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export const generateMetadata = pageTitle("accessReview");

type U = Awaited<ReturnType<typeof getAccessReview>>["expiring"][number];

function Users({ rows, empty, testid }: { rows: U[]; empty: string; testid: string }) {
  const tsys = useTranslations("sysadm");
  const fmt = makeFormat(useLocale() as Locale);
  if (!rows.length) return <p className="py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table className="text-sm" data-testid={testid}>
      <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{tsys("user")}</TableHead><TableHead>{tsys("tenant")}</TableHead><TableHead>{tsys("roles")}</TableHead><TableHead>{tsys("lastLogin")}</TableHead><TableHead>{tsys("accessExpires")}</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((u) => (
          <TableRow key={u.id}>
            <TableCell><Link href={`/admin/system/users/${u.id}`} className="font-medium text-primary hover:underline">{u.name}</Link><p className="text-xs text-muted-foreground">{u.email}</p></TableCell>
            <TableCell>{u.tenant} {u.tenantType === "VENDOR" && <Badge variant="warning">{tsys("vendor")}</Badge>}</TableCell>
            <TableCell className="max-w-64"><p>{u.roles.join(", ") || "—"}</p>{u.privileges.length > 0 && <p className="text-xs text-muted-foreground">{u.privileges.join(", ")}</p>}</TableCell>
            <TableCell className="whitespace-nowrap text-xs">{u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : tsys("never_")}</TableCell>
            <TableCell className="whitespace-nowrap text-xs">{u.accessExpiresAt ? fmt.dateTime(u.accessExpiresAt) : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function AccessReviewPage() {
  const tsys = await getTranslations("sysadm");
  const fmt = await getFormat();
  const actor = await requireAdminPortal();
  let r;
  try { r = await getAccessReview(actor); } catch (e) { if (e instanceof AuthorizationError) notFound(); throw e; }
  return (
    <div className="space-y-5">
      <PageHeader title={tsys("accessReview")} description={tsys("arDesc", { at: fmt.dateTime(r.generatedAt) })}
        actions={<Button asChild variant="outline"><a href="/api/admin/access-review" data-testid="access-review-csv"><Download /> {tsys("exportCsv")}</a></Button>} />
      <Card><CardHeader><CardTitle className="text-base">{tsys("arExpiring", { days: r.expiringDays, n: r.expiring.length })}</CardTitle>
        <CardDescription>{tsys("theUserAndAllUserAdministrators")}</CardDescription></CardHeader>
        <CardContent><Users rows={r.expiring} empty={tsys("arNoneExpiring")} testid="ar-expiring" /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{tsys("arExpired", { n: r.expired.length })}</CardTitle>
        <CardDescription>{tsys("signInIsAlreadyBlockedDeactivate")}</CardDescription></CardHeader>
        <CardContent><Users rows={r.expired} empty={tsys("none")} testid="ar-expired" /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{tsys("arInactive", { days: r.inactiveDays, n: r.inactive.length })}</CardTitle></CardHeader>
        <CardContent><Users rows={r.inactive} empty={tsys("none")} testid="ar-inactive" /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{tsys("arPrivileged", { n: r.privileged.length })}</CardTitle>
        <CardDescription>{tsys("holdersOfUserRoleTenantAdministration")}</CardDescription></CardHeader>
        <CardContent><Users rows={r.privileged} empty={tsys("none")} testid="ar-privileged" /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{tsys("arTokens", { n: r.tokens.length })}</CardTitle></CardHeader>
        <CardContent>
          {r.tokens.length === 0 ? <p className="text-sm text-muted-foreground">{tsys("none")}</p> : (
            <ul className="space-y-1 text-sm">{r.tokens.map((t) => <li key={t.id}>{t.name} <span className="font-mono text-xs">{t.prefix}…</span> · {t.includeNames ? tsys("includesNames") : tsys("pseudonymous")} · {tsys("arTokenMeta", { name: t.createdBy.displayName, at: t.lastUsedAt ? fmt.dateTime(t.lastUsedAt) : tsys("never_") })}</li>)}</ul>
          )}
        </CardContent></Card>
    </div>
  );
}
