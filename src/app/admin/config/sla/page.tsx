import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { CrudPage } from "@/components/admin/crud-page";
import { RunSlaButton } from "@/components/admin/run-sla-button";
import { Alert } from "@/components/ui/misc";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("slaProfiles");

export default async function SlaProfilesPage() {
  const tcfg = await getTranslations("cfg");
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_SLA)) notFound();
  return CrudPage({
    actor, entity: "slaProfiles", rowLink: { label: "Targets", hrefPrefix: "/admin/config/sla/" },
    extra: (
      <div className="mb-4 space-y-3">
        <Alert>
          {tcfg("slaIntro")}
        </Alert>
        <RunSlaButton />
      </div>
    ),
  });
}
