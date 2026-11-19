import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getWorkflowMatrix } from "@/server/services/admin/users";
import { WorkflowMatrix } from "@/components/admin/workflow-matrix";
import { Alert, PageHeader } from "@/components/ui/misc";

export const metadata = { title: "Workflow" };

export default async function WorkflowPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_WORKFLOW)) notFound();
  const [{ statuses, transitions }, perms] = await Promise.all([
    getWorkflowMatrix(actor), prisma.permission.findMany({ where: { group: "Tickets" }, orderBy: { code: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Ticket Workflow" description="Controlled status transitions. Rules enforced server-side on every change." />
      <Alert className="mb-4">
        Built-in rules regardless of this matrix: WAITING statuses require a reason · RESOLVED requires a resolution summary and all required tasks completed ·
        CLOSED/CANCELLED tickets are read-only unless the user holds <code>ticket.closed.edit</code> · requesters can reopen only within the configured reopen window.
      </Alert>
      <WorkflowMatrix statuses={statuses.filter((s) => s.isActive)} transitions={transitions} permissionCodes={perms.map((p) => p.code)} />
    </div>
  );
}
