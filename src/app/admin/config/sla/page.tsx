import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { CrudPage } from "@/components/admin/crud-page";
import { RunSlaButton } from "@/components/admin/run-sla-button";
import { Alert } from "@/components/ui/misc";

export const metadata = { title: "SLA Profiles" };

export default async function SlaProfilesPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_SLA)) notFound();
  return CrudPage({
    actor, entity: "slaProfiles", rowLink: { label: "Targets", hrefPrefix: "/admin/config/sla/" },
    extra: (
      <div className="mb-4 space-y-3">
        <Alert>
          Response and resolution clocks run in business time of the profile&apos;s calendar (or 24×7 per priority), pause in the configured statuses,
          and are checked every minute by the SLA job: warnings at the profile threshold, breaches at 100%, plus escalation rules.
        </Alert>
        <RunSlaButton />
      </div>
    ),
  });
}
