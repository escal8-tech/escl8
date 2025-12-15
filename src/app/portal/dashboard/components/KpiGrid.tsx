"use client";

import { TooltipIcon } from "./TooltipIcon";
import type { StatsTotals } from "./types";

type Props = { totals: StatsTotals };

export function KpiGrid({ totals }: Props) {
  return (
    <div className="feature-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginTop: 24 }}>
      <div className="glass">
        <div className="muted">Total requests</div>
        <div style={{ fontSize: 26, marginTop: 6 }}>{totals.count ?? "—"}</div>
      </div>
      <div className="glass">
        <div className="muted">Revenue</div>
        <div style={{ fontSize: 26, marginTop: 6 }}>${(totals.revenue ?? 0).toFixed(2)}</div>
      </div>
      <div className="glass">
        <div className="muted">Paid</div>
        <div style={{ fontSize: 26, marginTop: 6 }}>{totals.paidCount ?? "—"}</div>
      </div>
      <div className="glass">
        <div className="muted">
          Deflection rate
          <TooltipIcon title="COMPLETED / (COMPLETED + FAILED)" />
        </div>
        <div style={{ fontSize: 26, marginTop: 6 }}>
          {typeof totals.deflectionRate === "number" ? `${Math.round(totals.deflectionRate * 100)}%` : "—"}
        </div>
      </div>
      <div className="glass">
        <div className="muted">
          Follow-up rate
          <TooltipIcon title="NEEDS_FOLLOWUP / TOTAL" />
        </div>
        <div style={{ fontSize: 26, marginTop: 6 }}>
          {typeof totals.followUpRate === "number" ? `${Math.round(totals.followUpRate * 100)}%` : "—"}
        </div>
      </div>
    </div>
  );
}