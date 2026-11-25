import Link from "next/link";
import { Search } from "lucide-react";
import { prisma } from "@/server/db";
import { NativeSelect, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";
import { currentLocale } from "@/i18n/server";
import { ln } from "@/lib/localized";

/** GET-form filter bar (works without JavaScript; state lives in the URL). */
export async function TicketFilters({ base, params, extra = false, hidden = {}, teamIds }: {
  base: string; params: Record<string, string | undefined>; extra?: boolean; hidden?: Record<string, string>;
  /** Restrict the team filter to these teams (undefined = all teams). */
  teamIds?: string[];
}) {
  const [statuses, priorities, categories, teams] = await Promise.all([
    prisma.ticketStatus.findMany({ where: { isActive: true }, orderBy: { order: "asc" } }),
    prisma.priority.findMany({ where: { isActive: true }, orderBy: { level: "asc" } }),
    prisma.category.findMany({ where: { parentId: null, isActive: true, deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    extra ? prisma.supportTeam.findMany({ where: { isActive: true, deletedAt: null, ...(teamIds ? { id: { in: teamIds } } : {}) }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const [t, locale] = await Promise.all([getTranslations("filters"), currentLocale()]);
  return (
    <form method="get" action={base} className="flex flex-wrap items-end gap-2 border-b p-3">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={params.q} placeholder={t("searchPlaceholder")} className="pl-9" aria-label={t("search")} />
      </div>
      <NativeSelect name="status" defaultValue={params.status ?? ""} className="w-40" aria-label={t("status")}>
        <option value="">{t("allStatuses")}</option>
        {statuses.map((s) => <option key={s.id} value={s.id}>{ln(s, locale)}</option>)}
      </NativeSelect>
      <NativeSelect name="priority" defaultValue={params.priority ?? ""} className="w-36" aria-label={t("priority")}>
        <option value="">{t("allPriorities")}</option>
        {priorities.map((p) => <option key={p.id} value={p.id}>{p.code} {ln(p, locale)}</option>)}
      </NativeSelect>
      <NativeSelect name="category" defaultValue={params.category ?? ""} className="w-40" aria-label={t("category")}>
        <option value="">{t("allCategories")}</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{ln(c, locale)}</option>)}
      </NativeSelect>
      {extra && (
        <NativeSelect name="team" defaultValue={params.team ?? ""} className="w-44" aria-label={t("team")}>
          <option value="">{t("allTeams")}</option>
          {teams.map((tm) => <option key={tm.id} value={tm.id}>{ln(tm, locale)}</option>)}
        </NativeSelect>
      )}
      <Button type="submit" variant="secondary">{t("apply")}</Button>
      <Button asChild variant="ghost"><Link href={`${base}${hidden.view ? `?view=${hidden.view}` : ""}`}>{t("reset")}</Link></Button>
    </form>
  );
}
