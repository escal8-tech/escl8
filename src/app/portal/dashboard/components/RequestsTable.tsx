"use client";

import { useState, useMemo } from "react";
import type { RequestRow, Source } from "./types";
import { SOURCE_CONFIG } from "./types";
import { formatMoney } from "./utils";

type Props = {
  rows: RequestRow[];
  onSelect: (id: string) => void;
};

const PAGE_SIZE = 15;

export function RequestsTable({ rows, onSelect }: Props) {
  const [page, setPage] = useState(0);
  const [sentimentFilter, setSentimentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paidFilter, setPaidFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Get unique values for filters
  const sentiments = useMemo(() => {
    const unique = new Set(rows.map((r) => r.sentiment).filter((s): s is string => Boolean(s)));
    return Array.from(unique).sort();
  }, [rows]);

  const statuses = useMemo(() => {
    const unique = new Set(
      rows
        .map((r) => r.status)
        .filter((s): s is string => Boolean(s))
    );
    return Array.from(unique).sort();
  }, [rows]);

  const sources = useMemo(() => {
    const unique = new Set(rows.map((r) => r.source || "whatsapp").filter((s): s is string => Boolean(s)));
    return Array.from(unique).sort();
  }, [rows]);

  // Apply filters
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (sentimentFilter !== "all" && r.sentiment !== sentimentFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (sourceFilter !== "all" && (r.source || "whatsapp") !== sourceFilter) return false;
      if (paidFilter !== "all") {
        const isPaid = paidFilter === "yes";
        if (r.paid !== isPaid) return false;
      }
      return true;
    });
  }, [rows, sentimentFilter, statusFilter, sourceFilter, paidFilter]);

  // Paginate
  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE);
  const paginatedRows = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

  // Reset page when filters change
  const handleFilterChange = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(0);
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

  return (
    <div className="glass" style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ fontSize: 18 }}>Customer requests</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={sentimentFilter}
            onChange={(e) => handleFilterChange(setSentimentFilter)(e.target.value)}
            style={selectStyle}
            aria-label="Filter by sentiment"
          >
            <option value="all">All sentiments</option>
            {sentiments.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => handleFilterChange(setStatusFilter)(e.target.value)}
            style={selectStyle}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={paidFilter}
            onChange={(e) => handleFilterChange(setPaidFilter)(e.target.value)}
            style={selectStyle}
            aria-label="Filter by paid"
          >
            <option value="all">All paid</option>
            <option value="yes">Paid</option>
            <option value="no">Not paid</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => handleFilterChange(setSourceFilter)(e.target.value)}
            style={selectStyle}
            aria-label="Filter by source"
          >
            <option value="all">All channels</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_CONFIG[s as Source]?.icon ?? "📱"} {SOURCE_CONFIG[s as Source]?.label ?? s}
              </option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 13 }}>{filteredRows.length} shown</span>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", fontSize: 13, color: "var(--muted)" }}>
              <th style={{ padding: "10px 8px" }}>Channel</th>
              <th style={{ padding: "10px 8px" }}>Customer</th>
              <th style={{ padding: "10px 8px" }}>Sentiment</th>
              <th style={{ padding: "10px 8px" }}>Status</th>
              <th style={{ padding: "10px 8px" }}>Price</th>
              <th style={{ padding: "10px 8px" }}>Paid</th>
              <th style={{ padding: "10px 8px" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((r) => {
              const source = r.source || "whatsapp";
              const config = SOURCE_CONFIG[source as Source];
              return (
                <tr
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelect(r.id);
                  }}
                  style={{
                    borderTop: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                >
                  <td style={{ padding: "12px 8px" }}>
                    <span
                      title={config?.label ?? source}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 500,
                        background: `${config?.color ?? "#94A3B8"}20`,
                        color: config?.color ?? "#94A3B8",
                      }}
                    >
                      {config?.icon ?? "📱"} {config?.label ?? source}
                    </span>
                  </td>
                  <td style={{ padding: "12px 8px" }}>{r.customerNumber}</td>
                  <td style={{ padding: "12px 8px", textTransform: "capitalize" }}>{r.sentiment}</td>
                  <td style={{ padding: "12px 8px" }}>
                    {(r.status || "").replace(/_/g, " ").toUpperCase()}
                  </td>
                  <td style={{ padding: "12px 8px" }}>{formatMoney(r.price)}</td>
                  <td style={{ padding: "12px 8px" }}>{r.paid ? "Yes" : "No"}</td>
                  <td style={{ padding: "12px 8px" }}>
                    {(() => {
                      const d = new Date(r.createdAt as Date | string);
                      const today = new Date();
                      const yesterday = new Date();
                      yesterday.setDate(today.getDate() - 1);
                      const sameDay = (a: Date, b: Date) =>
                        a.getFullYear() === b.getFullYear() &&
                        a.getMonth() === b.getMonth() &&
                        a.getDate() === b.getDate();
                      if (sameDay(d, today)) return "Today";
                      if (sameDay(d, yesterday)) return "Yesterday";
                      return d.toLocaleDateString();
                    })()}
                  </td>
                </tr>
              );
            })}
            {paginatedRows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 16 }} className="muted">No requests match filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <button
            className="btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ opacity: page === 0 ? 0.5 : 1 }}
          >
            Previous
          </button>
          <span className="muted" style={{ fontSize: 14 }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="btn"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{ opacity: page >= totalPages - 1 ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
