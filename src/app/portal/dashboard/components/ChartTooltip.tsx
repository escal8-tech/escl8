"use client";

import type { CSSProperties } from "react";

const chartTooltipStyle: CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.25)",
  background: "rgba(15,23,42,0.95)",
  color: "#f8fafc",
  padding: "8px 10px",
  minWidth: 150,
};

export function SharedChartTooltip({
  active,
  label,
  payload,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  labelFormatter?: (label: string | number) => string;
  valueFormatter?: (value: number | string, name: string) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div style={chartTooltipStyle}>
      {label !== undefined ? (
        <div style={{ color: "#cbd5e1", fontSize: 12, marginBottom: 6 }}>
          {labelFormatter ? labelFormatter(label) : String(label)}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {payload.map((entry, idx) => {
          const name = entry.name ?? "Value";
          const value = entry.value ?? 0;
          return (
            <div
              key={`${name}-${idx}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: entry.color || "#94a3b8",
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "#e2e8f0", fontSize: 12 }}>{name}</span>
              </div>
              <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>
                {valueFormatter ? valueFormatter(value, name) : String(value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
