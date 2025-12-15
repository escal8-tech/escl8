"use client";

import type { RequestRow } from "./types";
import { formatMoney } from "./utils";

type Props = {
  rows: RequestRow[];
  onSelect: (id: string) => void;
};

export function RequestsTable({ rows, onSelect }: Props) {
  return (
    <div className="glass" style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 18 }}>Customer requests</h2>
        <span className="muted" style={{ fontSize: 13 }}>{rows.length} shown</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", fontSize: 13, color: "var(--muted)" }}>
              <th style={{ padding: "10px 8px" }}>Customer number</th>
              <th style={{ padding: "10px 8px" }}>Sentiment</th>
              <th style={{ padding: "10px 8px" }}>Resolution status</th>
              <th style={{ padding: "10px 8px" }}>Price</th>
              <th style={{ padding: "10px 8px" }}>Paid</th>
              <th style={{ padding: "10px 8px" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect(r.id);
                }}
                style={{
                  borderTop: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <td style={{ padding: "12px 8px" }}>{r.customerNumber}</td>
                <td style={{ padding: "12px 8px", textTransform: "capitalize" }}>{r.sentiment}</td>
                <td style={{ padding: "12px 8px", textTransform: "capitalize" }}>{r.resolutionStatus}</td>
                <td style={{ padding: "12px 8px" }}>{formatMoney(r.price)}</td>
                <td style={{ padding: "12px 8px" }}>{r.paid ? "Yes" : "No"}</td>
                <td style={{ padding: "12px 8px" }}>{new Date(r.createdAt as any).toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 16 }} className="muted">No requests yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}