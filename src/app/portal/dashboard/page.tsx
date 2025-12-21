"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { DonutChart } from "./components/DonutChart";
import { KpiGrid } from "./components/KpiGrid";
import { RequestsAreaChart } from "./components/RequestsAreaChart";
import { RequestsTable } from "./components/RequestsTable";
import { RequestDrawer } from "./components/RequestDrawer";
import type { DonutDatum, RequestRow, StatsTotals } from "./components/types";

export default function DashboardPage() {
  const listQ = trpc.requests.list.useQuery({ limit: 100 });
  const statsQ = trpc.requests.stats.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => normalizeRequests(listQ.data || []), [listQ.data]);

  const selectedRequest = useMemo(() => {
    if (!selectedId) return null;
    return rows.find((r) => r.id === selectedId) ?? null;
  }, [rows, selectedId]);

  const timeSeries = useMemo(() => {
    if (!rows.length) return [] as { date: string; count: number }[];
    const map = new Map<string, number>();
    for (const r of rows) {
      const d = new Date(r.createdAt as unknown as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, count]) => ({ date, count }));
  }, [rows]);

  const sentimentSeries = useMemo(() => {
    const by = statsQ.data?.bySentiment || {};
    const positive = Number((by as any).positive ?? 0);
    const neutral = Number((by as any).neutral ?? 0);
    const negative = Number((by as any).negative ?? 0);
    return [
      { name: "positive", value: positive, color: "rgb(34,197,94)" },
      { name: "neutral", value: neutral, color: "rgb(148,163,184)" },
      { name: "negative", value: negative, color: "rgb(239,68,68)" },
    ] satisfies DonutDatum[];
  }, [statsQ.data]);

  const statusSeries = useMemo(() => {
    const by = (statsQ.data as any)?.byStatus || {};
    const ongoing = Number(by.ONGOING ?? 0);
    const needsFollowup = Number(by.NEEDS_FOLLOWUP ?? 0);
    const failed = Number(by.FAILED ?? 0);
    const completed = Number(by.COMPLETED ?? 0);
    return [
      { name: "ONGOING", value: ongoing, color: "rgb(0,180,255)" },
      { name: "NEEDS_FOLLOWUP", value: needsFollowup, color: "rgb(234,179,8)" },
      { name: "FAILED", value: failed, color: "rgb(239,68,68)" },
      { name: "COMPLETED", value: completed, color: "rgb(34,197,94)" },
    ] satisfies DonutDatum[];
  }, [statsQ.data]);

  return (
    <div className="container" style={{ padding: "24px 0 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, letterSpacing: "-0.3px" }}>Dashboard</h1>
          <p className="muted" style={{ marginTop: 8 }}>Overview of your customer requests and performance.</p>
        </div>
        <div style={{ alignSelf: "flex-start" }} />
      </div>

      <KpiGrid totals={(statsQ.data?.totals as StatsTotals) || {}} />

      <div className="feature-grid" style={{ gridTemplateColumns: "1.6fr 1fr 1fr" }}>
        <RequestsAreaChart data={timeSeries} />
        <DonutChart title="Sentiment" data={sentimentSeries} centerLabel={{ top: "100%", bottom: "Breakdown" }} />
        <DonutChart title="Statuses" data={statusSeries} centerLabel={{ top: "4", bottom: "Types" }} />
      </div>

      <RequestsTable rows={rows} onSelect={setSelectedId} />

      <RequestDrawer request={selectedRequest} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function normalizeRequests(requests: any[]): RequestRow[] {
  return requests.map((r) => ({
    ...r,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  }));
}
