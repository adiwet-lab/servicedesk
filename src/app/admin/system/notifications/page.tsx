import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { CHANNELS, NOTIFICATION_TYPES } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";
import { NotificationSettingsForm } from "@/components/admin/notification-settings-form";
import { Alert, PageHeader } from "@/components/ui/misc";

export const metadata = { title: "Notification Settings" };

export default async function NotificationSettingsPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_SETTINGS)) notFound();
  const disabled = await getSetting(prisma, "notifications.disabledTypes");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Notification Settings" description="Choose which events create notifications. In-app notifications are delivered in realtime." />
      <Alert className="mb-4">Email and Microsoft Teams channels are planned integrations (Phase 6). Turning an event off stops new notifications of that type for everyone; changes are audited.</Alert>
      <NotificationSettingsForm types={Object.entries(NOTIFICATION_TYPES).map(([code, label]) => ({ code, label }))} disabled={disabled}
        channels={CHANNELS.map((c) => ({ id: c.id, label: c.label, configured: c.configured }))} />
    </div>
  );
}
