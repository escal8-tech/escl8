"use client";

import { clamp, percent } from "./utils";
import type { DonutDatum } from "./types";

type Props = {
  title: string;
  data: DonutDatum[];
  centerLabel?: { top: string; bottom: string };
};

export function DonutChart({ title, data, centerLabel }: Props) {
  const total = data.reduce((acc, d) => acc + (d.value || 0), 0);
  const r = 46;
  const stroke = 12;
  const c = 2 * Math.PI * r;

  // Build segments as (offset, length)
  let acc = 0;
  const segments = data.map((d) => {
    const frac = total > 0 ? d.value / total : 0;
    const len = frac * c;
    const out = { ...d, offset: acc, len };
    acc += len;
    return out;
  });

  return (
    <div className="glass" style={{ height: 320, display: "flex", flexDirection: "column" }}>
      <div className="muted">{title}</div>
      <div style={{ height: 260, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <div style={{ width: 200, height: 200, margin: "0 auto", position: "relative" }}>
          <svg viewBox="0 0 120 120" width="200" height="200" style={{ display: "block" }}>
            {/* track */}
            <circle
              cx="60"
              cy="60"
              r={r}
              fill="transparent"
              stroke="rgba(127,127,127,0.18)"
              strokeWidth={stroke}
            />
            {/* segments */}
            {segments.map((s, idx) => (
              <circle
                key={idx}
                cx="60"
                cy="60"
                r={r}
                fill="transparent"
                stroke={s.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${clamp(s.len, 0, c)} ${c}`}
                strokeDashoffset={-s.offset}
                transform="rotate(-90 60 60)"
                style={{ opacity: total > 0 && s.value > 0 ? 1 : 0 }}
              />
            ))}
          </svg>

          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 22, letterSpacing: "-0.2px" }}>{centerLabel?.top ?? total}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{centerLabel?.bottom ?? "Total"}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          {data
            .filter((d) => (d.value ?? 0) > 0)
            .map((d) => (
              <span
                key={d.name}
                title={`${d.name}: ${d.value} (${percent(d.value, total)})`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.02)",
                  fontSize: 13,
                  cursor: "default",
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 999, background: d.color }} />
                <span style={{ textTransform: "capitalize" }}>{d.name}</span>
                <span className="muted">{percent(d.value, total)}</span>
              </span>
            ))}
          {total === 0 && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>No data yet.</div>}
        </div>
      </div>
    </div>
  );
}