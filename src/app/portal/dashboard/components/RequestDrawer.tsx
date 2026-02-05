"use client";

import type { RequestRow } from "./types";
import { formatMaybeDate, formatMoney, parseSummary, statusColors } from "./utils";

type Props = {
  request: RequestRow | null;
  onClose: () => void;
};

export function RequestDrawer({ request, onClose }: Props) {
  if (!request) return null;

  const colors = statusColors(request.status ?? request.resolutionStatus);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request details"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      tabIndex={-1}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,10,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        className="glass"
        style={{ width: "min(1000px, 96vw)", maxHeight: "85vh", overflow: "auto", padding: 22, position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="btn" onClick={onClose} style={{ position: "absolute", top: 12, right: 12 }}>
          Close
        </button>

        <h2>Request {request.customerNumber}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 10 }}>
          <div className="glass" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Sentiment</div>
            <div style={{ textTransform: "capitalize" }}>{request.sentiment || "—"}</div>
          </div>
          <div className="glass" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Status</div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 999,
                border: `1px solid ${colors.border}`,
                background: colors.bg,
                color: colors.text,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 999, background: colors.text }} />
              <span style={{ textTransform: "capitalize", fontWeight: 600 }}>
                {request.status ?? request.resolutionStatus ?? "Unknown"}
              </span>
            </span>
          </div>
          <div className="glass" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Price</div>
            <div>{formatMoney(request.price)}</div>
          </div>
          <div className="glass" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Paid</div>
            <div>{request.paid ? "Yes" : "No"}</div>
          </div>
          <div className="glass" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Created</div>
            <div>{formatMaybeDate(request.createdAt)}</div>
          </div>
          <div className="glass" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Updated</div>
            <div>{formatMaybeDate(request.updatedAt)}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 14 }}>
          <div className="glass" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Follow-up needed?</div>
            <div style={{ fontSize: 16, marginTop: 6 }}>
              {request.needsFollowup ? "Yes" : "No"}
            </div>
          </div>
          <div className="glass" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Payment details</div>
            <div style={{ fontSize: 14, marginTop: 6, whiteSpace: "pre-wrap" }}>
              {request.paymentDetails ?? "—"}
            </div>
          </div>
        </div>

        <div className="glass" style={{ padding: 14, marginTop: 14 }}>
          <div className="muted" style={{ fontSize: 12 }}>Summary</div>
          {(() => {
            const parsed = parseSummary(request.summary);
            if (parsed.kind === "list") {
              return (
                <ul style={{ margin: "10px 0 0 12px", padding: 0, display: "grid", gap: 6 }}>
                  {parsed.items.map((item, idx) => (
                    <li key={idx} style={{ lineHeight: 1.5 }}>{item}</li>
                  ))}
                </ul>
              );
            }
            return <p style={{ marginTop: 6, lineHeight: 1.6 }}>{parsed.text || "—"}</p>;
          })()}
        </div>
      </div>
    </div>
  );
}
