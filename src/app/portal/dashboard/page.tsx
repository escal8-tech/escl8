"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import type { DonutDatum, RequestRow } from "./components/types";
import {
  Area,
  AreaChart as ReAreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Bar,
  BarChart as ReBarChart,
  Label,
  Cell,
} from "recharts";

const RECENT_REQUESTS_PAGE_SIZE = 20;
type RequestSortKey = "customer" | "status" | "type" | "bot";

// Icons
const Icons = {
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  dollarSign: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  checkCircle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  trendingUp: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  trendingDown: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  messageCircle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  arrowUpRight: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  ),
  arrowDownRight: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="7" x2="17" y2="17" />
      <polyline points="17 7 17 17 7 17" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  ),
};

// Stat Card Component
function StatCard({
  label,
  value,
  change,
  changeLabel,
  icon,
  trend,
}: {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: React.ReactNode;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="stat-card hover-lift">
      <div className="stat-header">
        <span className="stat-label">{label}</span>
        <div className="stat-icon">{icon}</div>
      </div>
      <div className="stat-value">{value}</div>
      {change !== undefined && (
        <div className={`stat-change ${trend === "up" ? "stat-change-positive" : trend === "down" ? "stat-change-negative" : ""}`}>
          <span style={{ width: 14, height: 14 }}>
            {trend === "up" ? Icons.arrowUpRight : trend === "down" ? Icons.arrowDownRight : null}
          </span>
          <span>
            {change > 0 ? "+" : ""}
            {change}% {changeLabel}
          </span>
        </div>
      )}
    </div>
  );
}

// Mini Donut Chart Component
function MiniDonutChart({
  data,
  size = 180,
  centerTop,
  centerBottom,
}: {
  data: DonutDatum[];
  size?: number;
  centerTop?: string;
  centerBottom?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--surface-secondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="text-muted" style={{ fontSize: "var(--text-xs)" }}>No data</span>
      </div>
    );
  }

  return (
    <div style={{ width: size, height: size, margin: "0 auto" }}>
      <PieChart width={size} height={size}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={size * 0.36}
          outerRadius={size * 0.48}
          stroke="var(--card)"
          strokeWidth={4}
          startAngle={90}
          endAngle={-270}
          isAnimationActive={false}
        >
          {data.map((entry, idx) => (
            <Cell key={`${entry.name}-${idx}`} fill={entry.color} />
          ))}
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
              return (
                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                  {centerTop && (
                    <tspan x={viewBox.cx} y={viewBox.cy} style={{ fill: "#fff", fontSize: 28, fontWeight: 700 }}>
                      {centerTop}
                    </tspan>
                  )}
                  {centerBottom && (
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy || 0) + 24}
                      style={{ fill: "rgba(255,255,255,0.7)", fontSize: 12, letterSpacing: "0.14em", fontWeight: 600 }}
                    >
                      {centerBottom}
                    </tspan>
                  )}
                </text>
              );
            }}
          />
        </Pie>
        <Tooltip
          formatter={(value: number, _name, item) => {
            const totalValue = data.reduce((sum, d) => sum + d.value, 0);
            const pct = totalValue > 0 ? Math.round((Number(value) / totalValue) * 100) : 0;
            return [`${value} (${pct}%)`, (item?.payload as { name?: string })?.name ?? "Value"];
          }}
          contentStyle={{
            background: "rgba(9, 15, 28, 0.95)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            color: "#fff",
          }}
          itemStyle={{ color: "#fff" }}
          labelStyle={{ color: "#cbd5e1" }}
        />
      </PieChart>
    </div>
  );
}

function TicketCounterBarChart({
  data,
}: {
  data: { label: string; openCount: number; inProgressCount: number; totalActive: number }[];
}) {
  if (!data.length) {
    return <div className="text-muted">No ticket data.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ReBarChart data={data} layout="vertical" margin={{ top: 8, right: 14, left: 22, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" horizontal={false} />
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="label"
          axisLine={false}
          tickLine={false}
          width={120}
          tick={{ fill: "rgba(241,245,249,0.9)", fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: "rgba(148,163,184,0.08)" }}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "rgba(15,23,42,0.95)",
            color: "#f8fafc",
          }}
          formatter={(value: number, name: string, item) => {
            const key = String(item?.dataKey ?? "");
            if (key === "inProgressCount") return [`${value}`, "In Progress"];
            if (key === "openCount") return [`${value}`, "Open"];
            return [`${value}`, name];
          }}
        />
        <Bar dataKey="inProgressCount" stackId="active" fill="#D4A84B" radius={[0, 0, 6, 6]} />
        <Bar dataKey="openCount" stackId="active" fill="#ef4444" radius={[6, 6, 0, 0]} />
      </ReBarChart>
    </ResponsiveContainer>
  );
}

// Area Chart Component
function ActivityAreaChart({ data }: { data: { date: string; count: number }[] }) {
  if (!data.length) {
    return (
      <div className="empty-state" style={{ padding: "var(--space-8)" }}>
        <span className="text-muted">No activity data yet</span>
      </div>
    );
  }

  const formatDateShort = (value?: string) => {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? value
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div style={{ height: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <ReAreaChart data={data} margin={{ top: 10, right: 12, left: -8, bottom: 8 }}>
          <defs>
            <linearGradient id="fillRequests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.55} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDateShort}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={28}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeOpacity: 0.6 }}
            formatter={(value: number) => [value, "Requests"]}
            labelFormatter={(value: string) => formatDateShort(value)}
          />
          <Area
            type="natural"
            dataKey="count"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#fillRequests)"
            dot={false}
          />
        </ReAreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Request Row Component
function RequestRowItem({
  request,
  onSelect,
  onToggleBot,
  pendingIds,
}: {
  request: RequestRow;
  onSelect: () => void;
  onToggleBot: (customerId: string, botPaused: boolean) => void;
  pendingIds: Record<string, boolean>;
}) {
  const statusColors: Record<string, string> = {
    ongoing: "badge-info",
    completed: "badge-success",
    failed: "badge-error",
    assistance_required: "badge-warning",
    resolved: "badge-success",
    pending: "badge-warning",
    escalated: "badge-error",
    in_progress: "badge-info",
  };

  const displayPhone = request.customerNumber || "Unknown";
  const initials = displayPhone.slice(-2).toUpperCase();
  const statusValue = request.status ?? "ongoing";
  const createdAt = new Date(request.createdAt);
  const today = new Date();
  const isToday =
    createdAt.getDate() === today.getDate() &&
    createdAt.getMonth() === today.getMonth() &&
    createdAt.getFullYear() === today.getFullYear();
  const isCompleted = statusValue.toLowerCase() === "completed" || statusValue.toLowerCase() === "resolved";
  const canToggle = Boolean(request.customerId) && isToday && !isCompleted;
  const paused = Boolean(request.botPaused);
  const isPending = request.customerId ? Boolean(pendingIds[request.customerId]) : false;

  return (
    <tr onClick={onSelect} style={{ cursor: "pointer" }}>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div className="avatar avatar-sm">
            {initials}
          </div>
          <div>
            <div style={{ fontWeight: 500 }}>{displayPhone}</div>
            <div className="text-muted" style={{ fontSize: "var(--text-xs)" }}>
              {(() => {
                const today = new Date();
                const createdKey = createdAt.toISOString().slice(0, 10);
                const todayKey = today.toISOString().slice(0, 10);
                const yesterdayKey = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
                if (createdKey === todayKey) return "Today";
                if (createdKey === yesterdayKey) return "Yesterday";
                return createdAt.toLocaleDateString();
              })()}
            </div>
          </div>
        </div>
      </td>
      <td>
        <span className={`badge ${statusColors[statusValue] || "badge-default"}`}>
          {statusValue.replace(/_/g, " ").toUpperCase()}
        </span>
      </td>
      <td>
        <span className="badge badge-default">
          {(request.type ?? "BROWSING").replace(/_/g, " ").toUpperCase()}
        </span>
      </td>
      <td>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            if (!canToggle || isPending || !request.customerId) return;
            onToggleBot(request.customerId, !paused);
          }}
          disabled={!canToggle || isPending}
          title={
            !request.customerId
              ? "No customer linked"
              : !isToday
              ? "Only today's conversation can be paused"
              : isCompleted
              ? "Completed conversations cannot be paused"
              : paused
              ? "Resume bot"
              : "Pause bot"
          }
          style={{ opacity: !canToggle || isPending ? 0.5 : 1, width: 112, justifyContent: "center" }}
        >
          <span style={{ width: 16, height: 16 }}>{paused ? Icons.play : Icons.pause}</span>
          {paused ? "Resume" : "Pause"}
        </button>
      </td>
    </tr>
  );
}

// Drawer Component
function RequestDrawer({
  request,
  onClose,
}: {
  request: RequestRow | null;
  onClose: () => void;
}) {
  if (!request) return null;

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-header">
          <h3 className="drawer-title">Request Details</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <span style={{ width: 20, height: 20 }}>{Icons.x}</span>
          </button>
        </div>
        <div className="drawer-body">
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            {/* Customer Info */}
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

            {/* Summary */}
            <div>
              <h4 style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: "var(--space-3)" }}>
                Summary
              </h4>
              <div className="card">
                <div className="card-body">
                  {(() => {
                    const raw = typeof request.summary === "string" ? request.summary : request.text || "";
                    if (!raw) return <p className="text-muted">No summary available</p>;
                    
                    // Parse JSON array string like ["- item1", "- item2"]
                    let items: string[] = [];
                    const trimmed = raw.trim();
                    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                      try {
                        const parsed = JSON.parse(trimmed);
                        if (Array.isArray(parsed)) {
                          items = parsed.map((s: unknown) => 
                            String(s ?? "").trim().replace(/^[-•]\s*/, "")
                          ).filter(Boolean);
                        }
                      } catch {
                        // Fallback: split by comma inside brackets
                        const inner = trimmed.slice(1, -1);
                        items = inner.split(/['"],\s*['"]/).map(s => 
                          s.replace(/^['"]|['"]$/g, "").replace(/^[-•]\s*/, "").trim()
                        ).filter(Boolean);
                      }
                    }
                    
                    if (items.length > 0) {
                      return (
                        <ul style={{ margin: 0, paddingLeft: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
                          {items.map((item, idx) => (
                            <li key={idx} className="text-muted" style={{ lineHeight: 1.5 }}>{item}</li>
                          ))}
                        </ul>
                      );
                    }
                    
                    return <p className="text-muted">{raw}</p>;
                  })()}
                </div>
              </div>
            </div>

            {/* Status & Sentiment */}
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
                  <span className={`badge badge-${request.sentiment === "positive" ? "success" : request.sentiment === "negative" ? "error" : "default"}`}>
                    {request.sentiment || "neutral"}
                  </span>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div>
              <h4 style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: "var(--space-3)" }}>
                Timeline
              </h4>
              <div className="card">
                <div className="card-body">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span style={{ width: 16, height: 16, color: "var(--foreground-muted)" }}>{Icons.clock}</span>
                    <span className="text-muted" style={{ fontSize: "var(--text-sm)" }}>
                      Created {new Date(request.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {request.updatedAt && request.updatedAt !== request.createdAt && (
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                      <span style={{ width: 16, height: 16, color: "var(--foreground-muted)" }}>{Icons.clock}</span>
                      <span className="text-muted" style={{ fontSize: "var(--text-sm)" }}>
                        Updated {new Date(request.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { selectedPhoneNumberId } = usePhoneFilter();
  const listInput = useMemo(
    () => ({
      limit: 100,
      ...(selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}),
    }),
    [selectedPhoneNumberId],
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
    requestListInput: listInput,
    requestStatsInput: statsInput,
    requestActivityInput: activityInput,
    customerListInput: customersInput,
    ticketListInputs: [{ limit: 500 }],
  });

  const listQ = trpc.requests.list.useQuery(listInput);
  const statsQ = trpc.requests.stats.useQuery(statsInput);
  const activityQ = trpc.requests.activitySeries.useQuery(activityInput);
  const ticketTypesQ = trpc.tickets.listTypes.useQuery({ includeDisabled: true });
  const ticketsQ = trpc.tickets.listTickets.useQuery({ limit: 500 });
  const customerStatsQ = trpc.customers.getStats.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<RequestSortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
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
        utils.requests.list.cancel(listInput),
        utils.customers.list.cancel(customersInput),
      ]);

      const prevList = utils.requests.list.getData(listInput);
      const prevCustomers = utils.customers.list.getData(customersInput);

      utils.requests.list.setData(listInput, (old) =>
        old?.map((item) =>
          item.customerId === vars.customerId ? { ...item, botPaused: vars.botPaused } : item,
        ),
      );
      utils.customers.list.setData(customersInput, (old) =>
        old?.map((item) =>
          item.id === vars.customerId ? { ...item, botPaused: vars.botPaused } : item,
        ),
      );

      return { prevList, prevCustomers };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevList) utils.requests.list.setData(listInput, ctx.prevList);
      if (ctx?.prevCustomers) utils.customers.list.setData(customersInput, ctx.prevCustomers);
      markPending(vars.customerId, false);
    },
    onSettled: (_data, _err, vars) => {
      if (vars?.customerId) markPending(vars.customerId, false);
      utils.requests.list.invalidate(listInput);
      utils.requests.stats.invalidate(statsInput);
      utils.customers.list.invalidate(customersInput);
      utils.customers.getStats.invalidate();
    },
  });

  const rows = useMemo(() => normalizeRequests(listQ.data || []), [listQ.data]);
  const statusOptions = useMemo(() => {
    const unique = new Set(
      rows
        .map((r) => (r.status || "").trim())
        .filter((value) => value.length > 0),
    );
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredAndSortedRows = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? rows
        : rows.filter((request) => (request.status || "").toLowerCase() === statusFilter.toLowerCase());

    const sorted = [...filtered].sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "customer") {
        return a.customerNumber.localeCompare(b.customerNumber) * direction;
      }
      if (sortKey === "status") {
        return (a.status || "").localeCompare(b.status || "") * direction;
      }
      if (sortKey === "type") {
        return (a.type || "").localeCompare(b.type || "") * direction;
      }
      const botA = a.botPaused ? 1 : 0;
      const botB = b.botPaused ? 1 : 0;
      return (botA - botB) * direction;
    });

    return sorted;
  }, [rows, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedRows.length / RECENT_REQUESTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);

  const paginatedRows = useMemo(() => {
    const start = safePage * RECENT_REQUESTS_PAGE_SIZE;
    return filteredAndSortedRows.slice(start, start + RECENT_REQUESTS_PAGE_SIZE);
  }, [filteredAndSortedRows, safePage]);

  const selectedRequest = useMemo(() => {
    if (!selectedId) return null;
    return rows.find((r) => r.id === selectedId) ?? null;
  }, [rows, selectedId]);

  const timeSeries = useMemo(() => {
    if (activityQ.data?.length) {
      return activityQ.data.map((row) => ({ date: row.date, count: Number(row.count) }));
    }
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

  const statusSeries = useMemo(() => {
    const by = (statsQ.data as { byStatus?: Record<string, number> })?.byStatus || {};
    const ongoing = Number(by.ONGOING ?? 0);
    const needsFollowup = Number(by.NEEDS_FOLLOWUP ?? 0);
    const failed = Number(by.FAILED ?? 0);
    const completed = Number(by.COMPLETED ?? 0);
    return [
      { name: "ONGOING", value: ongoing, color: "#0033A0" },
      { name: "NEEDS_FOLLOWUP", value: needsFollowup, color: "#f59e0b" },
      { name: "FAILED", value: failed, color: "#ef4444" },
      { name: "COMPLETED", value: completed, color: "#10b981" },
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

  const statusTotal = statusBreakdown.reduce((sum, d) => sum + d.value, 0);
  const successValue = statusBreakdown.find((d) => d.name === "SUCCESS")?.value ?? 0;
  const successPct = statusTotal > 0 ? Math.round((successValue / statusTotal) * 100) : 0;

  const sentimentTotal = sentimentSeries.reduce((sum, d) => sum + d.value, 0);
  const positiveValue = sentimentSeries.find((d) => d.name === "positive")?.value ?? 0;
  const positivePct = sentimentTotal > 0 ? Math.round((positiveValue / sentimentTotal) * 100) : 0;
  const ticketTypeCounters = useMemo(() => {
    const counts = new Map<string, { openCount: number; inProgressCount: number }>();
    for (const ticket of ticketsQ.data ?? []) {
      const key = (ticket.ticketTypeKey || "").toLowerCase();
      const status = String(ticket.status || "").toLowerCase();
      const current = counts.get(key) ?? { openCount: 0, inProgressCount: 0 };
      if (status === "open") {
        current.openCount += 1;
      } else if (status === "in_progress" || status === "pending") {
        current.inProgressCount += 1;
      }
      counts.set(key, current);
    }
    return (ticketTypesQ.data ?? [])
      .map((type) => {
        const counter = counts.get(type.key) ?? { openCount: 0, inProgressCount: 0 };
        const totalActive = counter.openCount + counter.inProgressCount;
        return {
          key: type.key,
          label:
            (type.key === "ordercreation" ? "Orders" : type.label).length > 20
              ? `${(type.key === "ordercreation" ? "Orders" : type.label).slice(0, 20)}...`
              : (type.key === "ordercreation" ? "Orders" : type.label),
          enabled: type.enabled,
          openCount: counter.openCount,
          inProgressCount: counter.inProgressCount,
          totalActive,
        };
      });
  }, [ticketTypesQ.data, ticketsQ.data]);

  return (
    <div className="fade-in">
      {/* Charts Row */}
      <div className="grid grid-cols-4 gap-4" style={{ marginBottom: "var(--space-6)" }}>
        {/* Activity Chart */}
        <div className="chart-card" style={{ gridColumn: "span 2", minHeight: 360, display: "flex", flexDirection: "column" }}>
          <div className="chart-header" style={{ marginBottom: "var(--space-2)" }}>
            <h3 className="chart-title">Request Activity</h3>
            <div className="badge badge-default">Last 30 days</div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ActivityAreaChart data={timeSeries.slice(-30)} />
          </div>
        </div>

        {/* Status Donut */}
        <div className="chart-card" style={{ minHeight: 420, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div className="chart-header" style={{ marginBottom: "var(--space-2)" }}>
            <h3 className="chart-title">Status Breakdown</h3>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
            <MiniDonutChart data={statusBreakdown} size={220} centerTop={`${successPct}%`} centerBottom="SUCCESS" />
          </div>
          <div className="chart-legend" style={{ justifyContent: "center" }}>
            {statusBreakdown.map((s) => (
              <div key={s.name} className="chart-legend-item">
                <div className="chart-legend-dot" style={{ background: s.color }} />
                <span style={{ textTransform: "capitalize" }}>{s.name.replace("_", " ").toLowerCase()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sentiment Donut */}
        <div className="chart-card" style={{ minHeight: 420, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div className="chart-header" style={{ marginBottom: "var(--space-2)" }}>
            <h3 className="chart-title">Sentiment Breakdown</h3>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
            <MiniDonutChart data={sentimentSeries} size={220} centerTop={`${positivePct}%`} centerBottom="POSITIVE" />
          </div>
          <div className="chart-legend" style={{ justifyContent: "center" }}>
            {sentimentSeries.map((s) => (
              <div key={s.name} className="chart-legend-item">
                <div className="chart-legend-dot" style={{ background: s.color }} />
                <span style={{ textTransform: "capitalize" }}>{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Requests + Ticket Counters */}
      <div className="grid grid-cols-4 gap-4">
      <div className="card" style={{ gridColumn: "span 2", height: 520, display: "flex", flexDirection: "column" }}>
        <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h3 className="card-title">Recent Requests</h3>
            <p className="card-description">Your latest customer interactions</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Status:</span>
            <PortalSelect
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(0);
              }}
              options={[
                { value: "all", label: "All statuses" },
                ...statusOptions.map((status) => ({
                  value: status,
                  label: status.replace(/_/g, " ").toUpperCase(),
                })),
              ]}
              style={{ minWidth: 150 }}
              ariaLabel="Filter recent requests by status"
            />
            <Link
              href="/portal/requests"
              className="btn btn-ghost btn-sm"
              style={{ height: 34, display: "inline-flex", alignItems: "center" }}
            >
              View all
            </Link>
          </div>
        </div>
        <div className="table-container" style={{ border: "none", borderRadius: 0, flex: 1, minHeight: 0, overflow: "auto" }}>
          <table className="table table-clickable">
            <thead>
              <tr>
                <th
                  style={{ cursor: "pointer", userSelect: "none" }}
                  onClick={() => {
                    if (sortKey === "customer") {
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setSortKey("customer");
                      setSortDir("asc");
                    }
                    setPage(0);
                  }}
                >
                  Customer {sortKey === "customer" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                </th>
                <th
                  style={{ cursor: "pointer", userSelect: "none" }}
                  onClick={() => {
                    if (sortKey === "status") {
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setSortKey("status");
                      setSortDir("asc");
                    }
                    setPage(0);
                  }}
                >
                  Status {sortKey === "status" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                </th>
                <th
                  style={{ cursor: "pointer", userSelect: "none" }}
                  onClick={() => {
                    if (sortKey === "type") {
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setSortKey("type");
                      setSortDir("asc");
                    }
                    setPage(0);
                  }}
                >
                  Type {sortKey === "type" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                </th>
                <th
                  style={{ cursor: "pointer", userSelect: "none" }}
                  onClick={() => {
                    if (sortKey === "bot") {
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setSortKey("bot");
                      setSortDir("asc");
                    }
                    setPage(0);
                  }}
                >
                  Bot {sortKey === "bot" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedRows.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state" style={{ padding: "var(--space-8)" }}>
                      <div className="empty-state-icon">{Icons.messageCircle}</div>
                      <div className="empty-state-title">No requests yet</div>
                      <div className="empty-state-description">
                        When customers start messaging, their requests will appear here.
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedRows.map((request) => (
                  <RequestRowItem
                    key={request.id}
                    request={request}
                    onSelect={() => setSelectedId(request.id)}
                    onToggleBot={(customerId, botPaused) => togglePause.mutate({ customerId, botPaused })}
                    pendingIds={pendingIds}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            marginTop: "auto",
          }}
        >
          <span className="text-muted" style={{ fontSize: 12 }}>
            Showing {paginatedRows.length} of {filteredAndSortedRows.length}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage <= 0}
            >
              Prev
            </button>
            <span className="text-muted" style={{ minWidth: 88, textAlign: "center", fontSize: 12 }}>
              Page {safePage + 1} / {totalPages}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
            >
              Next
            </button>
          </div>
        </div>
      </div>
      <div className="card" style={{ gridColumn: "span 2", height: 520, display: "flex", flexDirection: "column" }}>
        <div className="card-header">
          <h3 className="card-title">Ticket Counters</h3>
          <p className="card-description">Open + in-progress tickets by type (resolved/closed excluded)</p>
        </div>
        <div className="card-body" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {ticketTypeCounters.length === 0 ? (
            <div className="text-muted">No ticket types available.</div>
          ) : (
            <div style={{ flex: 1, minHeight: 0 }}>
              <TicketCounterBarChart
                data={ticketTypeCounters.map((x) => ({
                  label: x.label,
                  openCount: x.openCount,
                  inProgressCount: x.inProgressCount,
                  totalActive: x.totalActive,
                }))}
              />
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Request Drawer */}
      <RequestDrawer request={selectedRequest} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function normalizeRequests(requests: Record<string, unknown>[]): RequestRow[] {
  return requests.map((r) => ({
    ...(r as RequestRow),
    createdAt: r.createdAt instanceof Date ? (r.createdAt as Date).toISOString() : (r.createdAt as string),
    updatedAt: r.updatedAt instanceof Date ? (r.updatedAt as Date).toISOString() : (r.updatedAt as string),
  }));
}

