import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getSystemSettings } from "@/server/services/admin/system";
import { SequenceForm, SettingsForm } from "@/components/admin/settings-forms";
import { PageHeader } from "@/components/ui/misc";

export const metadata = { title: "System Settings" };

export default async function SettingsPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_SETTINGS)) notFound();
  const d = await getSystemSettings(actor);
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="System Settings" description="All changes are audited." />
      {d.sequences.map((s) => <SequenceForm key={s.key} seq={s} />)}
      <SettingsForm s={d.settings} teams={d.teams} priorities={d.priorities} statuses={d.statuses} />
    </div>
  );
}
