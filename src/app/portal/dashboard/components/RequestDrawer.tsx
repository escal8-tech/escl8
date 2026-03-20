"use client";

import type { RequestRow } from "./types";
import { parseSummary } from "./utils";
import { DashboardIcons } from "./dashboard-icons";

type Props = {
  request: RequestRow | null;
  onClose: () => void;
};

export function RequestDrawer({ request, onClose }: Props) {
  if (!request) return null;

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-header">
          <h3 className="drawer-title">Request Details</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <span style={{ width: 20, height: 20 }}>{DashboardIcons.x}</span>
          </button>
        </div>
        <div className="drawer-body">
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <div>
              <h4 style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: "var(--space-3)" }}>
                Customer Information
              </h4>
              <div className="card">
                <div className="card-body" style={{ display: "grid", gap: "var(--space-3)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <div className="avatar avatar-lg">
                      {request.customerNumber?.slice(-2).toUpperCase() || "?"}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{request.customerNumber || "Unknown"}</div>
                      <div className="text-muted">
                        Request created {new Date(request.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: "var(--space-3)" }}>
                Summary
              </h4>
              <div className="card">
                <div className="card-body">
                  {(() => {
                    const raw = typeof request.summary === "string" ? request.summary : request.text || "";
                    if (!raw) return <p className="text-muted">No summary available</p>;
                    const parsed = parseSummary(raw);
                    if (parsed.kind === "list") {
                      return (
                        <ul style={{ margin: 0, paddingLeft: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
                          {parsed.items.map((item, idx) => (
                            <li key={idx} className="text-muted" style={{ lineHeight: 1.5 }}>{item}</li>
                          ))}
                        </ul>
                      );
                    }
                    return <p className="text-muted">{parsed.text || "No summary available"}</p>;
                  })()}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              <div className="card">
                <div className="card-body">
                  <div className="text-muted" style={{ fontSize: "var(--text-xs)", marginBottom: "var(--space-2)" }}>
                    Status
                  </div>
                  {(() => {
                    const statusValue = (request.status ?? "ongoing").toLowerCase();
                    const badge =
                      statusValue === "completed" || statusValue === "resolved"
                        ? "success"
                        : statusValue === "failed"
                        ? "error"
                        : statusValue === "assistance_required" || statusValue === "assistance-required"
                        ? "warning"
                        : "info";
                    return (
                      <span className={`badge badge-${badge}`}>
                        {statusValue.replace(/_/g, " ").toUpperCase()}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="card">
                <div className="card-body">
                  <div className="text-muted" style={{ fontSize: "var(--text-xs)", marginBottom: "var(--space-2)" }}>
                    Sentiment
                  </div>
                  <span
                    className={`badge badge-${request.sentiment === "positive" ? "success" : request.sentiment === "negative" ? "error" : "default"}`}
                  >
                    {request.sentiment || "neutral"}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: "var(--space-3)" }}>
                Timeline
              </h4>
              <div className="card">
                <div className="card-body">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span style={{ width: 16, height: 16, color: "var(--foreground-muted)" }}>{DashboardIcons.clock}</span>
                    <span className="text-muted" style={{ fontSize: "var(--text-sm)" }}>
                      Created {new Date(request.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {request.updatedAt && request.updatedAt !== request.createdAt ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                      <span style={{ width: 16, height: 16, color: "var(--foreground-muted)" }}>{DashboardIcons.clock}</span>
                      <span className="text-muted" style={{ fontSize: "var(--text-sm)" }}>
                        Updated {new Date(request.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
