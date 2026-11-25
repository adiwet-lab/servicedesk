"use client";
/**
 * Chart primitives (Recharts) following the data-viz method:
 * - one hue for a single measure; validated categorical order for identity; ordinal ramp for ordered dimensions
 * - thin marks (2px lines, 4px rounded bar ends), 2px surface gaps between stacked segments
 * - recessive grid/axes, one y-axis, tooltips on every chart, legend for >= 2 series
 * Colors are CSS variables (globals.css) so dark mode uses its own validated steps.
 */
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useTranslations } from "next-intl";

const AXIS = { fontSize: 11, fill: "var(--viz-muted)" };
const tooltipProps = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" },
  labelStyle: { color: "var(--popover-foreground)", fontWeight: 600 },
  itemStyle: { color: "var(--popover-foreground)" },
};
const legendProps = { wrapperStyle: { fontSize: 12, color: "var(--muted-foreground)" }, iconType: "circle" as const, iconSize: 8 };

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];
export const ORDINAL = ["var(--ord-1)", "var(--ord-2)", "var(--ord-3)", "var(--ord-4)"];

/** Horizontal bars for one measure across categories (single hue unless rows carry an entity color). */
export function BarList({ data, height, useEntityColor = false, valueLabel }: {
  data: { name: string; count: number; color?: string }[]; height?: number; useEntityColor?: boolean; valueLabel?: string;
}) {
  const td = useTranslations("dash");
  valueLabel ??= td("tickets");
  const h = height ?? Math.max(120, data.length * 30 + 30);
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">{td("noDataForTheSelectedFilters")}</p>;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
        <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={{ stroke: "var(--viz-axis)" }} tickLine={false} />
        <YAxis type="category" dataKey="name" width={140} tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps} cursor={{ fill: "var(--muted)", opacity: 0.6 }} formatter={(v) => [v, valueLabel]} />
        <Bar dataKey="count" name={valueLabel} fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={18}>
          {useEntityColor && data.map((d, i) => <Cell key={i} fill={d.color ?? "var(--series-1)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** True when a series has gaps or very few values (lines alone would hide single points). */
function sparse(data: Record<string, string | number | null>[], key: string) {
  const vals = data.map((d) => d[key]);
  const present = vals.filter((v) => v != null).length;
  return present > 0 && (present < vals.length || present <= 3);
}

/** Two or more series over time on one shared axis. */
export function TrendLines({ data, series, height = 260, percent = false }: {
  data: Record<string, string | number | null>[]; series: { key: string; label: string }[]; height?: number; percent?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: -8, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
        <XAxis dataKey="period" tick={AXIS} interval="preserveStartEnd" minTickGap={24} axisLine={{ stroke: "var(--viz-axis)" }} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={percent ? 48 : 40}
          domain={percent ? [0, 100] : undefined} tickFormatter={percent ? (v: number) => `${v}%` : undefined} />
        <Tooltip {...tooltipProps} cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
          formatter={(v, name) => [v == null ? "—" : percent ? `${v}%` : v, name]} />
        {series.length > 1 && <Legend {...legendProps} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES[i]} strokeWidth={2}
            // Sparse series (isolated points) get markers so single values remain visible.
            dot={sparse(data, s.key) ? { r: 4, fill: SERIES[i], stroke: "var(--viz-surface)", strokeWidth: 2 } : false}
            activeDot={{ r: 4, stroke: "var(--viz-surface)", strokeWidth: 2 }} connectNulls={percent} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Stacked vertical bars (e.g. aging buckets × priority) using the ordinal ramp. */
export function StackedColumns({ data, keys, height = 260, xKey = "label" }: {
  data: Record<string, string | number>[]; keys: string[]; height?: number; xKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -8, right: 12, top: 8, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} axisLine={{ stroke: "var(--viz-axis)" }} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={40} />
        <Tooltip {...tooltipProps} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
        {keys.length > 1 && <Legend {...legendProps} />}
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} stackId="s" fill={ORDINAL[Math.min(i, ORDINAL.length - 1)]} stroke="var(--viz-surface)" strokeWidth={2}
            radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={56} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Grouped horizontal bars for up to 3 measures per entity (e.g. agent workload). */
export function GroupedBars({ data, series, height }: {
  data: Record<string, string | number>[]; series: { key: string; label: string }[]; height?: number;
}) {
  const td = useTranslations("dash");
  const h = height ?? Math.max(160, data.length * (14 * series.length + 14) + 40);
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">{td("noDataForTheSelectedFilters")}</p>;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }} barGap={2} barCategoryGap={10}>
        <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
        <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={{ stroke: "var(--viz-axis)" }} tickLine={false} />
        <YAxis type="category" dataKey="name" width={130} tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
        <Legend {...legendProps} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
