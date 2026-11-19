"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#84cc16", "#ec4899", "#64748b"];
const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 } };

export function HBarChart({ data, height = 260 }: { data: { name: string; count: number; color?: string }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" allowDecimals={false} tick={axis} />
        <YAxis type="category" dataKey="name" width={130} tick={axis} />
        <Tooltip {...tooltipStyle} cursor={{ fill: "var(--muted)" }} />
        <Bar dataKey="count" name="Tickets" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.color ?? PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, height = 260 }: { data: { name: string; count: number; color?: string }[]; height?: number }) {
  const filtered = data.filter((d) => d.count > 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={filtered} dataKey="count" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
          {filtered.map((d, i) => <Cell key={i} fill={d.color ?? PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TrendChart({ data, height = 260 }: { data: { date: string; created: number; resolved: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: -16, right: 8 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={axis} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} tick={axis} />
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="created" name="Created" stroke="#3b82f6" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
