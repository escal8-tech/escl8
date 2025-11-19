"use client";

import { useMemo } from "react";
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

export default function DashboardPage() {
  const listQ = trpc.requests.list.useQuery({ limit: 100 });
  const statsQ = trpc.requests.stats.useQuery();

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
                <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px" }}>{r.customerNumber}</td>
                  <td style={{ padding: "12px 8px", textTransform: "capitalize" }}>{r.sentiment}</td>
                  <td style={{ padding: "12px 8px", textTransform: "capitalize" }}>{r.resolutionStatus}</td>
                  <td style={{ padding: "12px 8px" }}>${Number(r.price as unknown as string || 0).toFixed(2)}</td>
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
    </div>
  );
}
