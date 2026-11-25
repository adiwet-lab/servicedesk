import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Actor } from "@/server/authz/actor";
import { can, canAny } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { isOrgWide } from "@/server/services/analytics";
import { cn } from "@/lib/utils";

export type DashboardKey = "management" | "team" | "agent" | "sla" | "aging" | "workload";

export function dashboardsFor(actor: Actor): { key: DashboardKey; label: string; href: string }[] {
  const support = canAny(actor, [P.DASHBOARD_SUPPORT, P.TICKET_READ_ALL]);
  const out: { key: DashboardKey; label: string; href: string }[] = [];
  if (isOrgWide(actor)) out.push({ key: "management", label: "Management", href: "/admin/dashboards/management" });
  if (actor.leadTeamIds.length > 0 || (support && isOrgWide(actor))) out.push({ key: "team", label: "Team", href: "/admin/dashboards/team" });
  if (support && can(actor, P.TICKET_UPDATE)) out.push({ key: "agent", label: "My work", href: "/admin/dashboards/agent" });
  out.push({ key: "sla", label: "SLA", href: "/admin/dashboards/sla" });
  out.push({ key: "aging", label: "Ticket aging", href: "/admin/dashboards/aging" });
  if (actor.leadTeamIds.length > 0 || isOrgWide(actor)) out.push({ key: "workload", label: "Workload", href: "/admin/dashboards/workload" });
  return out;
}

/** Default dashboard for a role: management → team lead → agent. */
export function defaultDashboard(actor: Actor): string {
  const list = dashboardsFor(actor);
  return (list.find((d) => d.key === "management") ?? list.find((d) => d.key === "team") ?? list.find((d) => d.key === "agent") ?? list[0])!.href;
}

export function DashboardTabs({ actor, current, query }: { actor: Actor; current: DashboardKey; query?: string }) {
  const td = useTranslations("dash");
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b" aria-label={td("dashboards")} data-testid="dashboard-tabs">
      {dashboardsFor(actor).map((d) => (
        <Link key={d.key} href={`${d.href}${query ? `?${query}` : ""}`}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm", d.key === current ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          aria-current={d.key === current ? "page" : undefined}>
          {td(`tab.${d.key}`)}
        </Link>
      ))}
    </nav>
  );
}
