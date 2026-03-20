"use client";

import { Cell, Label, Pie, PieChart, Tooltip } from "recharts";
import type { DonutDatum } from "./types";
import { SharedChartTooltip } from "./ChartTooltip";

export function MiniDonutChart({
  data,
  size = 180,
  centerTop,
  centerBottom,
}: {
  data: DonutDatum[];
  size?: number;
  centerTop?: string;
  centerBottom?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--surface-secondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="text-muted" style={{ fontSize: "var(--text-xs)" }}>No data</span>
      </div>
    );
  }

  return (
    <div style={{ width: size, height: size, margin: "0 auto" }}>
      <PieChart width={size} height={size}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={size * 0.36}
          outerRadius={size * 0.48}
          stroke="var(--card)"
          strokeWidth={4}
          startAngle={90}
          endAngle={-270}
          isAnimationActive={false}
        >
          {data.map((entry, idx) => (
            <Cell key={`${entry.name}-${idx}`} fill={entry.color} />
          ))}
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
              return (
                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                  {centerTop ? (
                    <tspan x={viewBox.cx} y={viewBox.cy} style={{ fill: "#fff", fontSize: 28, fontWeight: 700 }}>
                      {centerTop}
                    </tspan>
                  ) : null}
                  {centerBottom ? (
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy || 0) + 24}
                      style={{ fill: "rgba(255,255,255,0.7)", fontSize: 12, letterSpacing: "0.14em", fontWeight: 600 }}
                    >
                      {centerBottom}
                    </tspan>
                  ) : null}
                </text>
              );
            }}
          />
        </Pie>
        <Tooltip
          content={({ active }) => {
            if (!active) return null;
            return (
              <SharedChartTooltip
                active
                label="Breakdown"
                payload={data.map((entry) => ({
                  name: entry.name,
                  value: `${entry.value} (${total > 0 ? Math.round((entry.value / total) * 100) : 0}%)`,
                  color: entry.color,
                }))}
              />
            );
          }}
        />
      </PieChart>
    </div>
  );
}
