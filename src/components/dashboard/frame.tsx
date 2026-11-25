import { notFound } from "next/navigation";
import type { Actor } from "@/server/authz/actor";
import { canAny } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { dateWindow, getFilterOptions, parseAnalyticsFilters, type AnalyticsFilters } from "@/server/services/analytics";
import { PageHeader } from "@/components/ui/misc";
import { DashboardTabs, dashboardsFor, type DashboardKey } from "./dashboard-tabs";
import { FilterBar } from "./filter-bar";
import { currentLocale } from "@/i18n/server";

export async function loadDashboard(actor: Actor, key: DashboardKey, params: Record<string, string | undefined>) {
  if (!canAny(actor, [P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL])) notFound();
  if (!dashboardsFor(actor).some((d) => d.key === key)) notFound();
  const locale = await currentLocale();
  const filters = parseAnalyticsFilters(params, locale);
  const options = await getFilterOptions(actor, locale);
  return { filters, options, window: dateWindow(filters) };
}

export function DashboardFrame({ actor, current, title, description, params, options, filters, hide, children }: {
  actor: Actor; current: DashboardKey; title: string; description: string; params: Record<string, string | undefined>;
  options: Awaited<ReturnType<typeof getFilterOptions>>; filters: AnalyticsFilters; hide?: Parameters<typeof FilterBar>[0]["hide"]; children: React.ReactNode;
}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  const base = dashboardsFor(actor).find((d) => d.key === current)!.href;
  const w = dateWindow(filters);
  return (
    <div className="space-y-5">
      <PageHeader title={title} description={<>{description} <span className="whitespace-nowrap">· {w.label}</span></>} />
      <DashboardTabs actor={actor} current={current} query={query} />
      <FilterBar base={base} params={params} options={options} hide={hide} />
      {children}
    </div>
  );
}
