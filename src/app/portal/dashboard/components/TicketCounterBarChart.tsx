"use client";

import { Bar, BarChart as ReBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SharedChartTooltip } from "./ChartTooltip";

export function TicketCounterBarChart({
  data,
}: {
  data: { label: string; openCount: number; inProgressCount: number; totalActive: number }[];
}) {
  if (!data.length) {
    return <div className="text-muted">No ticket data.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ReBarChart data={data} layout="vertical" margin={{ top: 8, right: 14, left: 22, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" horizontal={false} />
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="label"
          axisLine={false}
          tickLine={false}
          width={120}
          tick={{ fill: "rgba(241,245,249,0.9)", fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: "rgba(148,163,184,0.08)" }}
          content={({ active, label, payload }) => (
            <SharedChartTooltip
              active={active}
              label={label}
              payload={payload as Array<{ name?: string; value?: number | string; color?: string }>}
              valueFormatter={(value) => String(value)}
            />
          )}
        />
        <Bar dataKey="inProgressCount" name="In Progress" stackId="active" fill="#D4A84B" radius={[6, 0, 0, 6]} />
        <Bar dataKey="openCount" name="Open" stackId="active" fill="#ef4444" radius={[0, 6, 6, 0]} />
      </ReBarChart>
    </ResponsiveContainer>
  );
}
