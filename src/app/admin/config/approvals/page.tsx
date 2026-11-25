import { notFound } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { listPolicies } from "@/server/services/approvals";
import { deletePolicyAction } from "@/server/actions/approvals";
import { PolicyDialog } from "@/components/approvals/approval-ui";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("approvalPolicies");

export default async function ApprovalPoliciesPage() {
  const tcfg = await getTranslations("cfg");
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_WORKFLOW)) notFound();
  const [policies, categories, users] = await Promise.all([
    listPolicies(actor),
    prisma.category.findMany({ where: { parentId: null, deletedAt: null }, orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, nameTh: true, children: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, nameTh: true } } } }),
    prisma.user.findMany({ where: { status: "ACTIVE", deletedAt: null, tenant: { type: { not: "VENDOR" } } }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
  ]);
  const userOpts = users.map((u) => ({ id: u.id, name: u.displayName }));
  return (
    <div className="space-y-5">
      <PageHeader title={tcfg("approvalPolicies")} description={tcfg("requireApprovalBeforeItStartsWork")}
        actions={<PolicyDialog categories={categories} users={userOpts} trigger={<Button data-testid="new-policy"><Plus /> {tcfg("newPolicy")}</Button>} />} />
      <Card>
        <CardContent className="pt-2">
          {policies.length === 0 ? <EmptyState title={tcfg("noApprovalPolicies")} /> : (
            <Table className="text-sm">
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{tcfg("policy")}</TableHead><TableHead>{tcfg("category")}</TableHead><TableHead>{tcfg("steps")}</TableHead><TableHead className="text-right">{tcfg("tickets")}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name} {!p.isActive && <Badge variant="secondary">{tcfg("inactive")}</Badge>}</TableCell>
                    <TableCell>{p.category.parent ? `${p.category.parent.name} › ` : ""}{p.category.name}</TableCell>
                    <TableCell>
                      <ol className="list-decimal pl-4">
                        {p.steps.map((s) => <li key={s.id}>{s.name}: {s.approverType === "REQUESTER_MANAGER" ? tcfg("requesterSManager") : s.approverUser?.displayName}{s.fallbackUser ? tcfg("fallbackUser", { name: s.fallbackUser.displayName }) : ""}</li>)}
                      </ol>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p._count.tickets}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <PolicyDialog categories={categories} users={userOpts}
                          policy={{ id: p.id, name: p.name, categoryId: p.categoryId, isActive: p.isActive, steps: p.steps.map((s) => ({ name: s.name, approverType: s.approverType, approverUserId: s.approverUserId, fallbackUserId: s.fallbackUserId })) }}
                          trigger={<Button size="icon" variant="ghost" aria-label={tcfg("editNamed", { name: p.name })}><Pencil /></Button>} />
                        {p._count.tickets === 0 && (
                          <form action={deletePolicyAction}><input type="hidden" name="policyId" value={p.id} />
                            <Button size="icon" variant="ghost" type="submit" aria-label={tcfg("deleteNamed", { name: p.name })}><Trash2 className="text-destructive" /></Button></form>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
