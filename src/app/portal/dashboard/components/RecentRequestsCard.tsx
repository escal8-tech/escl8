"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import { PortalBotToggleButton } from "@/app/portal/components/PortalBotToggleButton";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { DashboardIcons } from "./dashboard-icons";
import type { RequestRow } from "./types";

export const RECENT_REQUESTS_PAGE_SIZE = 20;
export type RequestSortKey = "customer" | "status" | "type" | "bot";
const REQUEST_STATUS_OPTIONS = [
  "ongoing",
  "completed",
  "failed",
  "assistance_required",
  "resolved",
  "pending",
  "escalated",
  "in_progress",
  "needs_followup",
] as const;

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
      <td data-label="Bot" style={{ textAlign: "center" }}>
        <PortalBotToggleButton
          available={Boolean(request.customerId)}
          paused={paused}
          pending={isPending}
          disabled={!canToggle}
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
          onToggle={() => {
            if (!request.customerId) return;
            onToggleBot(request.customerId, !paused);
          }}
        />
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
    </tr>
  );
}

export function RecentRequestsCard({
  rows,
  totalCount,
  page,
  totalPages,
  statusFilter,
  sortKey,
  sortDir,
  pendingIds,
  onStatusFilterChange,
  onToggleSort,
  onPageChange,
  onSelectRequest,
  onToggleBot,
}: {
  rows: RequestRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  statusFilter: string;
  sortKey: RequestSortKey;
  sortDir: "asc" | "desc";
  pendingIds: Record<string, boolean>;
  onStatusFilterChange: (value: string) => void;
  onToggleSort: (key: RequestSortKey) => void;
  onPageChange: (page: number) => void;
  onSelectRequest: (requestId: string) => void;
  onToggleBot: (customerId: string, botPaused: boolean) => void;
}) {
  const statusOptions = useMemo(() => {
    const values = new Set<string>(REQUEST_STATUS_OPTIONS);
    if (statusFilter !== "all") values.add(statusFilter);
    return Array.from(values);
  }, [statusFilter]);
  const safePage = Math.min(page, Math.max(totalPages, 1) - 1);

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
              onStatusFilterChange(value);
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
              <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onToggleSort("customer")}>
                Customer {sortKey === "customer" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </th>
              <th style={{ cursor: "pointer", userSelect: "none", textAlign: "center", width: 72 }} onClick={() => onToggleSort("bot")}>
                Bot {sortKey === "bot" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </th>
              <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onToggleSort("status")}>
                Status {sortKey === "status" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </th>
              <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onToggleSort("type")}>
                Type {sortKey === "type" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </th>
            </tr>
          </thead>
          <tbody>
            {totalCount === 0 ? (
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
              rows.map((request) => (
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
        shownCount={rows.length}
        totalCount={totalCount}
        canPrev={safePage > 0}
        canNext={safePage < totalPages - 1}
        onPrev={() => onPageChange(Math.max(0, safePage - 1))}
        onNext={() => onPageChange(Math.min(totalPages - 1, safePage + 1))}
        onPageChange={onPageChange}
      />
    </div>
  );
}
