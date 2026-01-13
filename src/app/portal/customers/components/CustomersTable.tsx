"use client";

import { useState, useMemo } from "react";
import type { CustomerRow } from "../types";

type Props = {
  rows: CustomerRow[];
  onSelect: (waId: string) => void;
};

const PAGE_SIZE = 15;

export function CustomersTable({ rows, onSelect }: Props) {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [intentFilter, setIntentFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("lastMessageAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  // Apply filters
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (intentFilter === "high" && !r.isHighIntent) return false;
      if (intentFilter === "low" && r.isHighIntent) return false;
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesName = r.name?.toLowerCase().includes(searchLower);
        const matchesPhone = r.waId.includes(search);
        if (!matchesName && !matchesPhone) return false;
      }
      return true;
    });
  }, [rows, statusFilter, intentFilter, search]);

  // Sort
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      let aVal: number | string | Date | null = null;
      let bVal: number | string | Date | null = null;

      switch (sortBy) {
        case "lastMessageAt":
          aVal = a.lastMessageAt?.getTime() ?? 0;
          bVal = b.lastMessageAt?.getTime() ?? 0;
          break;
        case "totalRevenue":
          aVal = parseFloat(a.totalRevenue);
          bVal = parseFloat(b.totalRevenue);
          break;
        case "totalRequests":
          aVal = a.totalRequests;
          bVal = b.totalRequests;
          break;
        case "leadScore":
          aVal = a.leadScore;
          bVal = b.leadScore;
          break;
        case "name":
          aVal = a.name?.toLowerCase() ?? "";
          bVal = b.name?.toLowerCase() ?? "";
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredRows, sortBy, sortDir]);

  // Paginate
  const totalPages = Math.ceil(sortedRows.length / PAGE_SIZE);
  const paginatedRows = useMemo(() => {
    const start = page * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, page]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  };

  const selectStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--glass-bg)",
    color: "var(--foreground)",
    fontSize: 13,
    minWidth: 120,
  };

  const inputStyle: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--glass-bg)",
    color: "var(--foreground)",
    fontSize: 13,
    minWidth: 200,
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "—";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  const formatCurrency = (value: string) => {
    const num = parseFloat(value);
    if (num === 0) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "MYR",
    }).format(num);
  };

  const getSentimentColor = (sentiment: string | null) => {
    switch (sentiment) {
      case "positive":
        return "#22c55e";
      case "negative":
        return "#ef4444";
      default:
        return "var(--muted)";
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      active: { bg: "rgba(34, 197, 94, 0.1)", text: "#22c55e" },
      vip: { bg: "rgba(184, 134, 11, 0.2)", text: "var(--gold-light)" },
      blocked: { bg: "rgba(239, 68, 68, 0.1)", text: "#ef4444" },
      archived: { bg: "rgba(148, 163, 184, 0.1)", text: "var(--muted)" },
    };
    const style = colors[status] ?? colors.active;
    return (
      <span
        style={{
          padding: "2px 8px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 500,
          background: style.bg,
          color: style.text,
          textTransform: "capitalize",
        }}
      >
        {status}
      </span>
    );
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return null;
    return (
      <span style={{ marginLeft: 4, fontSize: 10 }}>
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  };

  return (
    <div className="glass" style={{ marginTop: 0 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 18 }}>Customers</h2>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            placeholder="Search name or phone..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            style={inputStyle}
          />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            style={selectStyle}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="vip">VIP</option>
            <option value="blocked">Blocked</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={intentFilter}
            onChange={(e) => {
              setIntentFilter(e.target.value);
              setPage(0);
            }}
            style={selectStyle}
            aria-label="Filter by intent"
          >
            <option value="all">All intent levels</option>
            <option value="high">High intent</option>
            <option value="low">Regular</option>
          </select>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th
                onClick={() => handleSort("name")}
                style={{
                  textAlign: "left",
                  padding: "12px 8px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                Customer
                <SortIcon field="name" />
              </th>
              <th
                onClick={() => handleSort("totalRequests")}
                style={{
                  textAlign: "center",
                  padding: "12px 8px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                Requests
                <SortIcon field="totalRequests" />
              </th>
              <th
                onClick={() => handleSort("totalRevenue")}
                style={{
                  textAlign: "right",
                  padding: "12px 8px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                Revenue
                <SortIcon field="totalRevenue" />
              </th>
              <th
                onClick={() => handleSort("leadScore")}
                style={{
                  textAlign: "center",
                  padding: "12px 8px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                Lead Score
                <SortIcon field="leadScore" />
              </th>
              <th style={{ textAlign: "center", padding: "12px 8px" }}>
                Sentiment
              </th>
              <th style={{ textAlign: "center", padding: "12px 8px" }}>
                Status
              </th>
              <th
                onClick={() => handleSort("lastMessageAt")}
                style={{
                  textAlign: "right",
                  padding: "12px 8px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                Last Active
                <SortIcon field="lastMessageAt" />
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row) => (
              <tr
                key={row.waId}
                onClick={() => onSelect(row.waId)}
                style={{
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background =
                    "rgba(184, 134, 11, 0.05)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <td style={{ padding: "12px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg, var(--gold), var(--gold-light))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#000",
                        flexShrink: 0,
                      }}
                    >
                      {row.name?.[0]?.toUpperCase() ?? row.waId.slice(-2)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 500 }}>
                        {row.name || "Unknown"}
                        {row.isHighIntent && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              padding: "2px 6px",
                              background: "rgba(184, 134, 11, 0.2)",
                              color: "var(--gold-light)",
                              borderRadius: 4,
                            }}
                          >
                            HIGH INTENT
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          marginTop: 2,
                        }}
                      >
                        +{row.waId}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: "center", padding: "12px 8px" }}>
                  {row.totalRequests}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "12px 8px",
                    fontWeight: 500,
                    color: parseFloat(row.totalRevenue) > 0 ? "#22c55e" : "var(--muted)",
                  }}
                >
                  {formatCurrency(row.totalRevenue)}
                </td>
                <td style={{ textAlign: "center", padding: "12px 8px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 6,
                        background: "var(--glass-bg)",
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${row.leadScore}%`,
                          height: "100%",
                          background:
                            row.leadScore > 70
                              ? "#22c55e"
                              : row.leadScore > 40
                              ? "var(--gold)"
                              : "var(--muted)",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12 }}>{row.leadScore}</span>
                  </div>
                </td>
                <td style={{ textAlign: "center", padding: "12px 8px" }}>
                  <span
                    style={{
                      color: getSentimentColor(row.lastSentiment),
                      textTransform: "capitalize",
                      fontSize: 12,
                    }}
                  >
                    {row.lastSentiment || "—"}
                  </span>
                </td>
                <td style={{ textAlign: "center", padding: "12px 8px" }}>
                  {getStatusBadge(row.status)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "12px 8px",
                    color: "var(--muted)",
                    fontSize: 13,
                  }}
                >
                  {formatDate(row.lastMessageAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Showing {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, sortedRows.length)} of{" "}
            {sortedRows.length}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: page === 0 ? "transparent" : "var(--glass-bg)",
                color: page === 0 ? "var(--muted)" : "var(--foreground)",
                cursor: page === 0 ? "not-allowed" : "pointer",
                fontSize: 13,
              }}
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background:
                  page >= totalPages - 1 ? "transparent" : "var(--glass-bg)",
                color:
                  page >= totalPages - 1 ? "var(--muted)" : "var(--foreground)",
                cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
                fontSize: 13,
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
