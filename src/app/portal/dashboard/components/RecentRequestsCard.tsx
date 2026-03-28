"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { DashboardIcons } from "./dashboard-icons";
import type { RequestRow } from "./types";

const RECENT_REQUESTS_PAGE_SIZE = 20;
type RequestSortKey = "customer" | "status" | "type" | "bot";

function formatRelativeRequestDate(value: string | Date) {
  const createdAt = new Date(value);
  const today = new Date();
  const createdKey = createdAt.toISOString().slice(0, 10);
  const todayKey = today.toISOString().slice(0, 10);
  const yesterdayKey = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  if (createdKey === todayKey) return "Today";
  if (createdKey === yesterdayKey) return "Yesterday";
  return createdAt.toLocaleDateString();
}

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
      <td data-label="Customer">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div className="avatar avatar-sm">{initials}</div>
          <div>
            <div style={{ fontWeight: 500 }}>{displayPhone}</div>
            <div className="text-muted" style={{ fontSize: "var(--text-xs)" }}>
              {formatRelativeRequestDate(createdAt)}
            </div>
          </div>
        </div>
      </td>
      <td data-label="Status">
        <span className={`badge ${statusColors[statusValue] || "badge-default"}`}>
          {statusValue.replace(/_/g, " ").toUpperCase()}
        </span>
      </td>
      <td data-label="Type">
        <span className="badge badge-default">
          {(request.type ?? "BROWSING").replace(/_/g, " ").toUpperCase()}
        </span>
      </td>
      <td data-label="Bot">
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
          <span style={{ width: 16, height: 16 }}>{paused ? DashboardIcons.play : DashboardIcons.pause}</span>
          {paused ? "Resume" : "Pause"}
        </button>
      </td>
    </tr>
  );
}

export function RecentRequestsCard({
  rows,
  pendingIds,
  onSelectRequest,
  onToggleBot,
}: {
  rows: RequestRow[];
  pendingIds: Record<string, boolean>;
  onSelectRequest: (requestId: string) => void;
  onToggleBot: (customerId: string, botPaused: boolean) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<RequestSortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

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

    return [...filtered].sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "customer") return (a.customerNumber || "").localeCompare(b.customerNumber || "") * direction;
      if (sortKey === "status") return (a.status || "").localeCompare(b.status || "") * direction;
      if (sortKey === "type") return (a.type || "").localeCompare(b.type || "") * direction;
      const botA = a.botPaused ? 1 : 0;
      const botB = b.botPaused ? 1 : 0;
      return (botA - botB) * direction;
    });
  }, [rows, statusFilter, sortDir, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedRows.length / RECENT_REQUESTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedRows = useMemo(() => {
    const start = safePage * RECENT_REQUESTS_PAGE_SIZE;
    return filteredAndSortedRows.slice(start, start + RECENT_REQUESTS_PAGE_SIZE);
  }, [filteredAndSortedRows, safePage]);

  const toggleSort = (key: RequestSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  return (
    <div className="card portal-dashboard-card portal-dashboard-card--requests portal-dashboard-requests-card" style={{ height: 520, display: "flex", flexDirection: "column" }}>
      <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 className="card-title">Recent Requests</h3>
          <p className="card-description">Your latest customer interactions</p>
        </div>
        <div className="portal-dashboard-requests-card__controls" style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
            href="/requests"
            className="btn btn-ghost btn-sm"
            style={{ height: 34, display: "inline-flex", alignItems: "center" }}
          >
            View all
          </Link>
        </div>
      </div>
      <div className="table-container" style={{ border: "none", borderRadius: 0, flex: 1, minHeight: 0, overflow: "auto" }}>
        <table className="table table-clickable portal-modern-table portal-mobile-cards portal-dashboard-requests-table">
          <thead>
            <tr>
              <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort("customer")}>
                Customer {sortKey === "customer" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </th>
              <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort("status")}>
                Status {sortKey === "status" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </th>
              <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort("type")}>
                Type {sortKey === "type" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </th>
              <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort("bot")}>
                Bot {sortKey === "bot" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedRows.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className="empty-state" style={{ padding: "var(--space-8)" }}>
                    <div className="empty-state-icon">{DashboardIcons.messageCircle}</div>
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
                  onSelect={() => onSelectRequest(request.id)}
                  onToggleBot={onToggleBot}
                  pendingIds={pendingIds}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={safePage}
        totalPages={totalPages}
        shownCount={paginatedRows.length}
        totalCount={filteredAndSortedRows.length}
        canPrev={safePage > 0}
        canNext={safePage < totalPages - 1}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
        onPageChange={setPage}
      />
    </div>
  );
}
