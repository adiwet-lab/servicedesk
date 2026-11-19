import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { listBusinessHours } from "@/server/services/admin/system";
import { BusinessHoursForm, type CalendarData } from "@/components/admin/business-hours-form";
import { PageHeader } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Business Hours" };

export default async function BusinessHoursPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_SLA)) notFound();
  const calendars = await listBusinessHours(actor);
  const zones = Intl.supportedValuesOf("timeZone");
  const blank: CalendarData = { id: null, name: "", timezone: "Asia/Bangkok", isDefault: false, schedule: { "1": [{ start: "08:30", end: "17:30" }], "2": [{ start: "08:30", end: "17:30" }], "3": [{ start: "08:30", end: "17:30" }], "4": [{ start: "08:30", end: "17:30" }], "5": [{ start: "08:30", end: "17:30" }] } };
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Business Hours & Working Days" description="Working windows per weekday and timezone. SLA clocks only run inside these windows (except 24×7 targets); holidays are excluded." />
      {calendars.map((c) => (
        <div key={c.id} className="space-y-2">
          <BusinessHoursForm timezones={zones}
            calendar={{ id: c.id, name: c.name, timezone: c.timezone, isDefault: c.isDefault, schedule: c.schedule as CalendarData["schedule"] }} />
          <p className="px-1 text-xs text-muted-foreground">
            Used by {c._count.profiles} SLA profile(s) · {c.holidays.length} holiday(s){c.holidays.length ? `: ${c.holidays.slice(0, 4).map((h) => `${formatDate(h.date)} ${h.name}`).join(", ")}${c.holidays.length > 4 ? "…" : ""}` : ""} · <Link href="/admin/config/holidays" className="text-primary hover:underline">Manage holidays</Link>
          </p>
        </div>
      ))}
      <BusinessHoursForm timezones={zones} calendar={blank} />
    </div>
  );
}
