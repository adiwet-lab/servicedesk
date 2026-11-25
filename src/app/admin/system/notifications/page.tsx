import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { CHANNELS, NOTIFICATION_TYPES } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";
import { NotificationSettingsForm } from "@/components/admin/notification-settings-form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";

export const generateMetadata = pageTitle("notificationSettings");

export default async function NotificationSettingsPage() {
  const tnotifSettings = await getTranslations("notifSettings");
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_SETTINGS)) notFound();
  const disabled = await getSetting(prisma, "notifications.disabledTypes");
  const teamsConnected = (await prisma.supportTeam.count({ where: { teamsWebhookEnc: { not: null }, deletedAt: null } })) > 0;
  return (
    <div className="max-w-4xl">
      <PageHeader title={tnotifSettings("notificationSettings")} description={tnotifSettings("chooseWhichEventsCreateNotificationsIn")} />
      <Alert className="mb-4">{tnotifSettings.rich("intro", { link: (c) => <a className="underline" href="/admin/integrations">{c}</a> })}</Alert>
      <NotificationSettingsForm types={Object.entries(NOTIFICATION_TYPES).map(([code, label]) => ({ code, label }))} disabled={disabled}
        channels={CHANNELS.map((c) => ({ id: c.id, label: c.label, configured: c.id === "teams" ? teamsConnected : c.configured }))} />
    </div>
  );
}
