"use client";

import { Area, AreaChart as ReAreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SharedChartTooltip } from "./ChartTooltip";

function formatDateShort(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ActivityAreaChart({ data }: { data: { date: string; count: number }[] }) {
  if (!data.length) {
    return (
      <div className="empty-state" style={{ padding: "var(--space-8)" }}>
        <span className="text-muted">No activity data yet</span>
      </div>
    );
  }

  return (
    <div style={{ height: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <ReAreaChart data={data} margin={{ top: 10, right: 12, left: -8, bottom: 8 }}>
          <defs>
            <linearGradient id="fillRequests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.55} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDateShort}
          />
          <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeOpacity: 0.6 }}
            content={({ active, label, payload }) => (
              <SharedChartTooltip
                active={active}
                label={label}
                payload={payload as Array<{ name?: string; value?: number | string; color?: string }>}
                labelFormatter={(value) => formatDateShort(String(value))}
                valueFormatter={(value) => `${value}`}
              />
            )}
          />
          <Area
            type="natural"
            dataKey="count"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#fillRequests)"
            dot={false}
          />
        </ReAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
