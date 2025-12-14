"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { WhatsAppEmbeddedSignupButton } from "@/components/WhatsAppEmbeddedSignup";

function formatMoney(value: unknown) {
  const n = Number(value ?? 0);
  return `$${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

function formatMaybeDate(value: unknown) {
  if (!value) return "—";
  const d = new Date(value as any);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function statusColors(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  if (s.includes("resolved") || s.includes("done") || s.includes("closed")) {
    return { bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.35)", text: "rgb(34,197,94)" };
  }
  if (s.includes("open") || s.includes("pending") || s.includes("new") || s.includes("in")) {
    return { bg: "rgba(0,180,255,0.14)", border: "rgba(0,180,255,0.35)", text: "rgb(0,180,255)" };
  }
  if (s.includes("reject") || s.includes("fail") || s.includes("cancel")) {
    return { bg: "rgba(239,68,68,0.14)", border: "rgba(239,68,68,0.35)", text: "rgb(239,68,68)" };
  }
  return { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.28)", text: "rgb(148,163,184)" };
}

export default function DashboardPage() {
  const listQ = trpc.requests.list.useQuery({ limit: 100 });
  const statsQ = trpc.requests.stats.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedRequest = useMemo(() => {
    if (!selectedId) return null;
    return (listQ.data ?? []).find((r) => r.id === selectedId) ?? null;
  }, [listQ.data, selectedId]);

  const timeSeries = useMemo(() => {
    if (!listQ.data) return [] as { date: string; count: number }[];
    const map = new Map<string, number>();
    for (const r of listQ.data) {
      const d = new Date(r.createdAt as unknown as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, count]) => ({ date, count }));
  }, [listQ.data]);

  const sentimentSeries = useMemo(() => {
    const by = statsQ.data?.bySentiment || {};
    return Object.entries(by).map(([name, value]) => ({ name, value }));
  }, [statsQ.data]);

  return (
    <div className="container" style={{ padding: "24px 0 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, letterSpacing: "-0.3px" }}>Dashboard</h1>
          <p className="muted" style={{ marginTop: 8 }}>Overview of your customer requests and performance.</p>
        </div>
        <div style={{ alignSelf: "flex-start" }}>
          <WhatsAppEmbeddedSignupButton />
        </div>
      </div>

      {/* KPI row */}
      <div className="feature-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 24 }}>
        <div className="glass">
          <div className="muted">Total requests</div>
          <div style={{ fontSize: 26, marginTop: 6 }}>{statsQ.data?.totals.count ?? "—"}</div>
        </div>
        <div className="glass">
          <div className="muted">Revenue</div>
          <div style={{ fontSize: 26, marginTop: 6 }}>${(statsQ.data?.totals.revenue ?? 0).toFixed(2)}</div>
        </div>
        <div className="glass">
          <div className="muted">Paid</div>
          <div style={{ fontSize: 26, marginTop: 6 }}>{statsQ.data?.totals.paidCount ?? "—"}</div>
        </div>
        <div className="glass">
          <div className="muted">Open</div>
          <div style={{ fontSize: 26, marginTop: 6 }}>{statsQ.data?.totals.openCount ?? "—"}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="feature-grid" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        <div className="glass" style={{ height: 320 }}>
          <div className="muted">Requests over time</div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6c47ff" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6c47ff" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,0.2)" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="#6c47ff" fill="url(#colorCount)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="glass" style={{ height: 320 }}>
          <div className="muted">Sentiment</div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sentimentSeries} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,0.2)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#00b4ff" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="glass" style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ fontSize: 18 }}>Customer requests</h2>
          <span className="muted" style={{ fontSize: 13 }}>{listQ.data?.length ?? 0} shown</span>
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
              {(listQ.data ?? []).map((r) => (
                <tr
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelectedId(r.id);
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
                  <td style={{ padding: "12px 8px" }}>{new Date(r.createdAt as unknown as string).toLocaleString()}</td>
                </tr>
              ))}
              {(!listQ.data || listQ.data.length === 0) && (
                <tr>
                  <td colSpan={6} style={{ padding: 16 }} className="muted">No requests yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRequest && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Request details"
          onClick={() => setSelectedId(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSelectedId(null);
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
            zIndex: 50,
          }}
        >
          <div
            className="glass"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 96vw)",
              maxHeight: "88vh",
              overflow: "auto",
              padding: 18,
            }}
          >
            <div style={{ display: "flex", gap: 14, justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>Request</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                  <h3 style={{ fontSize: 20, margin: 0, letterSpacing: "-0.2px" }}>
                    Customer #{selectedRequest.customerNumber}
                  </h3>
                  {(() => {
                    const c = statusColors(selectedRequest.resolutionStatus as any);
                    return (
                      <span
                        style={{
                          fontSize: 12,
                          padding: "4px 10px",
                          borderRadius: 999,
                          background: c.bg,
                          border: `1px solid ${c.border}`,
                          color: c.text,
                          textTransform: "capitalize",
                        }}
                      >
                        {selectedRequest.resolutionStatus}
                      </span>
                    );
                  })()}
                </div>
              </div>

              <button
                type="button"
                className="btn"
                onClick={() => setSelectedId(null)}
                aria-label="Close"
                style={{ padding: "8px 12px" }}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Summary</div>
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.02)",
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                }}
              >
                {(selectedRequest as any).summary ? (selectedRequest as any).summary : "—"}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 12,
                marginTop: 16,
              }}
            >
              <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Sentiment</div>
                <div style={{ marginTop: 6, textTransform: "capitalize" }}>{selectedRequest.sentiment}</div>
              </div>
              <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Paid</div>
                <div style={{ marginTop: 6 }}>{selectedRequest.paid ? "Yes" : "No"}</div>
              </div>
              <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Price</div>
                <div style={{ marginTop: 6 }}>{formatMoney(selectedRequest.price)}</div>
              </div>
              <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Created</div>
                <div style={{ marginTop: 6 }}>{formatMaybeDate(selectedRequest.createdAt)}</div>
              </div>
              <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Updated</div>
                <div style={{ marginTop: 6 }}>{formatMaybeDate((selectedRequest as any).updatedAt)}</div>
              </div>
              <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Request ID</div>
                <div style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
                  {selectedRequest.id}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
