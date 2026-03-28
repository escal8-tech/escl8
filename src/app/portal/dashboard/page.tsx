"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import type { DonutDatum, RequestRow } from "./components/types";
import { normalizeRequests } from "./components/utils";
import { ActivityAreaChart } from "./components/ActivityAreaChart";
import { MiniDonutChart } from "./components/MiniDonutChart";
import { RecentRequestsCard, type RequestSortKey, RECENT_REQUESTS_PAGE_SIZE } from "./components/RecentRequestsCard";
import { RequestDrawer } from "./components/RequestDrawer";
import { TicketCounterBarChart } from "./components/TicketCounterBarChart";
import { getPortalTicketTypeChartLabel } from "@/app/portal/lib/ticketTypes";

export default function DashboardPage() {
  const { selectedPhoneNumberId } = usePhoneFilter();
  const [recentStatusFilter, setRecentStatusFilter] = useState("all");
  const [recentSortKey, setRecentSortKey] = useState<RequestSortKey>("status");
  const [recentSortDir, setRecentSortDir] = useState<"asc" | "desc">("desc");
  const [recentPage, setRecentPage] = useState(0);
  const listInput = useMemo(
    () => ({
      limit: RECENT_REQUESTS_PAGE_SIZE,
      offset: recentPage * RECENT_REQUESTS_PAGE_SIZE,
      status: recentStatusFilter !== "all" ? recentStatusFilter : undefined,
      sortKey: recentSortKey,
      sortDir: recentSortDir,
      ...(selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}),
    }),
    [recentPage, recentSortDir, recentSortKey, recentStatusFilter, selectedPhoneNumberId],
  );
  const statsInput = useMemo(
    () => (selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : undefined),
    [selectedPhoneNumberId],
  );
  const activityInput = useMemo(
    () => ({ days: 30, ...(selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}) }),
    [selectedPhoneNumberId],
  );
  const customersInput = statsInput;

  useLivePortalEvents({
    requestPageInput: listInput,
    requestStatsInput: statsInput,
    requestActivityInput: activityInput,
    customerListInput: customersInput,
    refreshTicketTypeCounters: true,
  });

  const listQ = trpc.requests.listPage.useQuery(listInput);
  const statsQ = trpc.requests.stats.useQuery(statsInput);
  const activityQ = trpc.requests.activitySeries.useQuery(activityInput);
  const ticketTypesQ = trpc.tickets.listTypes.useQuery({ includeDisabled: true });
  const ticketCountersQ = trpc.tickets.getTypeCounters.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const utils = trpc.useUtils();

  const markPending = (customerId: string, pending: boolean) => {
    setPendingIds((prev) => {
      if (pending) return { ...prev, [customerId]: true };
      if (!prev[customerId]) return prev;
      const next = { ...prev };
      delete next[customerId];
      return next;
    });
  };

  const togglePause = trpc.customers.setBotPaused.useMutation({
    onMutate: async (vars) => {
      markPending(vars.customerId, true);
      await Promise.all([
        utils.requests.listPage.cancel(listInput),
        utils.customers.list.cancel(customersInput),
      ]);

      const prevList = utils.requests.listPage.getData(listInput);
      const prevCustomers = utils.customers.list.getData(customersInput);

      utils.requests.listPage.setData(listInput, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((item) =>
            item.customerId === vars.customerId ? { ...item, botPaused: vars.botPaused } : item,
          ),
        };
      });
      utils.customers.list.setData(customersInput, (old) =>
        old?.map((item) =>
          item.id === vars.customerId ? { ...item, botPaused: vars.botPaused } : item,
        ),
      );

      return { prevList, prevCustomers };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevList) utils.requests.listPage.setData(listInput, ctx.prevList);
      if (ctx?.prevCustomers) utils.customers.list.setData(customersInput, ctx.prevCustomers);
      markPending(vars.customerId, false);
    },
    onSettled: (_data, _err, vars) => {
      if (vars?.customerId) markPending(vars.customerId, false);
      utils.requests.listPage.invalidate(listInput);
      utils.requests.stats.invalidate(statsInput);
      utils.customers.list.invalidate(customersInput);
      utils.customers.getStats.invalidate();
    },
  });

  const rows = useMemo(
    () => normalizeRequests((listQ.data?.items ?? []) as RequestRow[]),
    [listQ.data?.items],
  );
  const recentTotalCount = listQ.data?.totalCount ?? 0;
  const recentTotalPages = Math.max(1, Math.ceil(recentTotalCount / RECENT_REQUESTS_PAGE_SIZE));
  const safeRecentPage = Math.min(recentPage, recentTotalPages - 1);
  useEffect(() => {
    if (safeRecentPage !== recentPage) {
      queueMicrotask(() => setRecentPage(safeRecentPage));
    }
  }, [recentPage, safeRecentPage]);
  const selectedRequest = useMemo(() => {
    if (!selectedId) return null;
    return rows.find((request) => request.id === selectedId) ?? null;
  }, [rows, selectedId]);
  const toggleRecentSort = (key: RequestSortKey) => {
    setRecentPage(0);
    if (recentSortKey === key) {
      setRecentSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setRecentSortKey(key);
    setRecentSortDir("asc");
  };

  const timeSeries = useMemo(() => {
    if (activityQ.data?.length) {
      return activityQ.data.map((row) => ({ date: row.date, count: Number(row.count) }));
    }
    if (!rows.length) return [] as { date: string; count: number }[];
    const map = new Map<string, number>();
    for (const row of rows) {
      const d = new Date(row.createdAt as unknown as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, count]) => ({ date, count }));
  }, [activityQ.data, rows]);

  const sentimentSeries = useMemo(() => {
    const by = statsQ.data?.bySentiment || {};
    const positive = Number((by as Record<string, number>).positive ?? 0);
    const neutral = Number((by as Record<string, number>).neutral ?? 0);
    const negative = Number((by as Record<string, number>).negative ?? 0);
    return [
      { name: "positive", value: positive, color: "#10b981" },
      { name: "neutral", value: neutral, color: "#94a3b8" },
      { name: "negative", value: negative, color: "#ef4444" },
    ] satisfies DonutDatum[];
  }, [statsQ.data]);

  const statusBreakdown = useMemo(() => {
    const by = (statsQ.data as { byStatus?: Record<string, number> })?.byStatus || {};
    const ongoing = Number(by.ONGOING ?? 0);
    const failed = Number(by.FAILED ?? 0);
    const completed = Number(by.COMPLETED ?? 0);
    return [
      { name: "ONGOING", value: ongoing, color: "#0033A0" },
      { name: "FAILED", value: failed, color: "#ef4444" },
      { name: "SUCCESS", value: completed, color: "#10b981" },
    ] satisfies DonutDatum[];
  }, [statsQ.data]);

  const statusTotal = statusBreakdown.reduce((sum, datum) => sum + datum.value, 0);
  const successValue = statusBreakdown.find((datum) => datum.name === "SUCCESS")?.value ?? 0;
  const successPct = statusTotal > 0 ? Math.round((successValue / statusTotal) * 100) : 0;

  const sentimentTotal = sentimentSeries.reduce((sum, datum) => sum + datum.value, 0);
  const positiveValue = sentimentSeries.find((datum) => datum.name === "positive")?.value ?? 0;
  const positivePct = sentimentTotal > 0 ? Math.round((positiveValue / sentimentTotal) * 100) : 0;

  const ticketTypeCounters = useMemo(() => {
    const counts = new Map(
      (ticketCountersQ.data ?? []).map((row) => [
        row.key,
        { openCount: row.openCount, inProgressCount: row.inProgressCount },
      ]),
    );
    return (ticketTypesQ.data ?? []).map((type) => {
      const counter = counts.get(type.key) ?? { openCount: 0, inProgressCount: 0 };
      const label = getPortalTicketTypeChartLabel(type.key) || type.label;
      return {
        key: type.key,
        label,
        enabled: type.enabled,
        openCount: counter.openCount,
        inProgressCount: counter.inProgressCount,
        totalActive: counter.openCount + counter.inProgressCount,
      };
    });
  }, [ticketCountersQ.data, ticketTypesQ.data]);

  return (
    <div className="fade-in portal-dashboard-shell">
      <div className="portal-dashboard-grid portal-dashboard-grid--analytics">
        <div className="chart-card portal-dashboard-card portal-dashboard-card--activity" style={{ minHeight: 360, display: "flex", flexDirection: "column" }}>
          <div className="chart-header" style={{ marginBottom: "var(--space-2)" }}>
            <h3 className="chart-title">Request Activity</h3>
            <div className="badge badge-default">Last 30 days</div>
          </div>
          <div className="portal-dashboard-chart-panel" style={{ flex: 1, minHeight: 0 }}>
            <ActivityAreaChart data={timeSeries.slice(-30)} />
          </div>
        </div>

        <div className="chart-card portal-dashboard-card" style={{ minHeight: 420, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div className="chart-header" style={{ marginBottom: "var(--space-2)" }}>
            <h3 className="chart-title">Status Breakdown</h3>
          </div>
          <div className="portal-dashboard-chart-panel" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
            <MiniDonutChart data={statusBreakdown} size={220} centerTop={`${successPct}%`} centerBottom="SUCCESS" />
          </div>
          <div className="chart-legend" style={{ justifyContent: "center" }}>
            {statusBreakdown.map((status) => (
              <div key={status.name} className="chart-legend-item">
                <div className="chart-legend-dot" style={{ background: status.color }} />
                <span style={{ textTransform: "capitalize" }}>{status.name.replace("_", " ").toLowerCase()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="chart-card portal-dashboard-card" style={{ minHeight: 420, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div className="chart-header" style={{ marginBottom: "var(--space-2)" }}>
            <h3 className="chart-title">Sentiment Breakdown</h3>
          </div>
          <div className="portal-dashboard-chart-panel" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
            <MiniDonutChart data={sentimentSeries} size={220} centerTop={`${positivePct}%`} centerBottom="POSITIVE" />
          </div>
          <div className="chart-legend" style={{ justifyContent: "center" }}>
            {sentimentSeries.map((sentiment) => (
              <div key={sentiment.name} className="chart-legend-item">
                <div className="chart-legend-dot" style={{ background: sentiment.color }} />
                <span style={{ textTransform: "capitalize" }}>{sentiment.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="portal-dashboard-grid portal-dashboard-grid--secondary">
        <RecentRequestsCard
          rows={rows}
          totalCount={recentTotalCount}
          page={safeRecentPage}
          totalPages={recentTotalPages}
          statusFilter={recentStatusFilter}
          sortKey={recentSortKey}
          sortDir={recentSortDir}
          pendingIds={pendingIds}
          onStatusFilterChange={(value) => {
            setRecentStatusFilter(value);
            setRecentPage(0);
          }}
          onToggleSort={toggleRecentSort}
          onPageChange={setRecentPage}
          onSelectRequest={setSelectedId}
          onToggleBot={(customerId, botPaused) => togglePause.mutate({ customerId, botPaused })}
        />

        <div className="card portal-dashboard-card portal-dashboard-card--counters" style={{ height: 520, display: "flex", flexDirection: "column" }}>
          <div className="card-header">
            <h3 className="card-title">Ticket Counters</h3>
            <p className="card-description">Open + in-progress tickets by type (resolved/closed excluded)</p>
          </div>
          <div className="card-body portal-dashboard-chart-panel" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {ticketTypeCounters.length === 0 ? (
              <div className="text-muted">No ticket types available.</div>
            ) : (
              <div style={{ flex: 1, minHeight: 0 }}>
                <TicketCounterBarChart
                  data={ticketTypeCounters.map((counter) => ({
                    label: counter.label,
                    openCount: counter.openCount,
                    inProgressCount: counter.inProgressCount,
                    totalActive: counter.totalActive,
                  }))}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <RequestDrawer request={selectedRequest} onClose={() => setSelectedId(null)} />
    </div>
  );
}
