"use client";
import Link from "next/link";
import { useState } from "react";
import { Filter, X } from "lucide-react";
import type { FilterOptions } from "@/server/services/analytics";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";

const RANGES = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["365d", "Last 12 months"], ["month", "Month to date"], ["custom", "Custom range"]] as const;
const DIMS = ["company", "department", "branch", "team", "category", "subcategory", "priority", "status", "agent"] as const;

/** URL-state filter bar (GET form) shared by all dashboards. */
export function FilterBar({ base, params, options, hide = [], hidden = {} }: {
  base: string; params: Record<string, string | undefined>; options: FilterOptions; hide?: (typeof DIMS[number])[];
  /** Extra params to keep (e.g. report type). */
  hidden?: Record<string, string>;
}) {
  const [range, setRange] = useState(params.range ?? "30d");
  const [category, setCategory] = useState(params.category ?? "");
  const subs = options.subcategories.filter((s) => !category || s.parentId === category);
  const show = (d: (typeof DIMS)[number]) => !hide.includes(d);
  const names: Record<string, Map<string, string>> = {
    company: new Map(options.companies.map((x) => [x.id, x.name])), department: new Map(options.departments.map((x) => [x.id, x.name])),
    branch: new Map(options.branches.map((x) => [x.id, x.name])), team: new Map(options.teams.map((x) => [x.id, x.name])),
    category: new Map(options.categories.map((x) => [x.id, x.name])), subcategory: new Map(options.subcategories.map((x) => [x.id, x.name])),
    priority: new Map(options.priorities.map((x) => [x.id, `${x.code} ${x.name}`])), status: new Map(options.statuses.map((x) => [x.id, x.name])),
    agent: new Map([["none", "Unassigned"], ...options.agents.map((x) => [x.id, x.displayName] as [string, string])]),
  };
  const active = DIMS.filter((d) => params[d]);
  const without = (k: string) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([kk, v]) => kk !== k && v) as [string, string][]);
    return `${base}${sp.toString() ? `?${sp}` : ""}`;
  };
  const sel = (name: string, label: string, opts: { id: string; name: string }[], extra?: React.ReactNode) => (
    <NativeSelect name={name} defaultValue={params[name] ?? ""} className="h-8 w-40 text-xs" aria-label={label} data-testid={`filter-${name}`}>
      <option value="">All {label.toLowerCase()}</option>{extra}{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </NativeSelect>
  );
  return (
    <div className="mb-5 space-y-2">
      <form method="get" action={base} className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3" data-testid="filter-bar">
        <Filter className="size-4 text-muted-foreground" aria-hidden />
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <NativeSelect name="range" value={range} onChange={(e) => setRange(e.target.value)} className="h-8 w-40 text-xs" aria-label="Date range" data-testid="filter-range">
          {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </NativeSelect>
        {range === "custom" && (
          <>
            <Input type="date" name="from" defaultValue={params.from} className="h-8 w-36 text-xs" aria-label="From" required />
            <Input type="date" name="to" defaultValue={params.to} className="h-8 w-36 text-xs" aria-label="To" />
          </>
        )}
        {show("company") && sel("company", "Companies", options.companies)}
        {show("department") && sel("department", "Departments", options.departments)}
        {show("branch") && sel("branch", "Branches", options.branches)}
        {show("team") && sel("team", "Teams", options.teams)}
        {show("category") && (
          <NativeSelect name="category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-40 text-xs" aria-label="Categories" data-testid="filter-category">
            <option value="">All categories</option>{options.categories.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </NativeSelect>
        )}
        {show("subcategory") && (
          <NativeSelect name="subcategory" defaultValue={params.subcategory ?? ""} key={category} className="h-8 w-40 text-xs" aria-label="Subcategories">
            <option value="">All subcategories</option>{subs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </NativeSelect>
        )}
        {show("priority") && sel("priority", "Priorities", options.priorities.map((p) => ({ id: p.id, name: `${p.code} ${p.name}` })))}
        {show("status") && sel("status", "Statuses", options.statuses)}
        {show("agent") && sel("agent", "Agents", options.agents.map((a) => ({ id: a.id, name: a.displayName })), <option value="none">Unassigned</option>)}
        <Button type="submit" size="sm" data-testid="filter-apply">Apply</Button>
        <Button asChild size="sm" variant="ghost"><Link href={`${base}${Object.keys(hidden).length ? `?${new URLSearchParams(hidden)}` : ""}`}>Reset</Link></Button>
      </form>
      {active.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="active-filters">
          {active.map((d) => (
            <Link key={d} href={without(d)} className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-0.5 text-xs hover:bg-accent">
              <span className="text-muted-foreground capitalize">{d}:</span> {names[d]?.get(params[d]!) ?? params[d]} <X className="size-3" aria-label="Remove" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
