import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireActor } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getCreateTicketOptions } from "@/server/services/tickets";
import { PageHeader } from "@/components/ui/misc";
import { CreateTicketForm } from "@/components/tickets/create-ticket-form";
import { KnownIssuesBanner } from "@/components/incidents/known-issues";

export const metadata = { title: "Create Ticket" };

export default async function NewTicketPage() {
  const actor = await requireActor();
  if (!can(actor, P.TICKET_CREATE)) notFound();
  const [opts, me] = await Promise.all([
    getCreateTicketOptions(actor),
    prisma.user.findUniqueOrThrow({ where: { id: actor.id }, include: { department: true, company: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Create Ticket" description="Report an incident or request IT service." />
      <div className="mb-5"><KnownIssuesBanner actor={actor} /></div>
      <CreateTicketForm
        {...opts}
        defaults={{ branchId: me.branchId, contactNumber: me.contactNumber, requester: me.displayName, department: me.department?.name ?? null, company: me.company?.name ?? null }}
      />
    </div>
  );
}
