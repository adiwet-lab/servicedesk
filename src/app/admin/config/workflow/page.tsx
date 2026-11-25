import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getWorkflowMatrix } from "@/server/services/admin/users";
import { WorkflowMatrix } from "@/components/admin/workflow-matrix";
import { Alert, PageHeader } from "@/components/ui/misc";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("workflow");

export default async function WorkflowPage() {
  const tcfg = await getTranslations("cfg");
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_WORKFLOW)) notFound();
  const [{ statuses, transitions }, perms] = await Promise.all([
    getWorkflowMatrix(actor), prisma.permission.findMany({ where: { group: "Tickets" }, orderBy: { code: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title={tcfg("ticketWorkflow")} description={tcfg("controlledStatusTransitionsRulesEnforcedServer")} />
      <Alert className="mb-4">
        {tcfg.rich("workflowRules", { code: (c) => <code>{c}</code> })}
      </Alert>
      <WorkflowMatrix statuses={statuses.filter((s) => s.isActive)} transitions={transitions} permissionCodes={perms.map((p) => p.code)} />
    </div>
  );
}
