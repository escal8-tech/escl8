"use client";

import { useState, useMemo } from "react";
import { CustomerRow, Source, SOURCE_CONFIG } from "../types";
import { SUPPORTED_SOURCES } from "@/../drizzle/schema";
import { trpc } from "@/utils/trpc";

const Icons = {
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

interface Props {
  rows: CustomerRow[];
  onSelect: (id: string) => void;
  listInput?: { whatsappIdentityId?: string };
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

function SourceBadge({ source }: { source: Source }) {
  const config = SOURCE_CONFIG[source];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bgColor}`}
    >
      {config.label}
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return <span className="text-gray-400">—</span>;

  const colors: Record<string, string> = {
    positive: "bg-green-100 text-green-800",
    neutral: "bg-gray-100 text-gray-800",
    negative: "bg-red-100 text-red-800",
  };

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[sentiment] ?? colors.neutral}`}
    >
      {sentiment}
    </span>
  );
}

function LeadScoreBar({ score }: { score: number }) {
  const color =
    score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 rounded-full bg-gray-200"
        style={{ width: 60 }}
      >
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs text-gray-600">{score}</span>
    </div>
  );
}

export function CustomersTable({ rows, onSelect, listInput, hasMore, isLoadingMore, onLoadMore }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<Source | "all">("all");
  const [sortKey, setSortKey] = useState<keyof CustomerRow>("lastMessageAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const utils = trpc.useUtils();
  const togglePause = trpc.customers.setBotPaused.useMutation({
    onMutate: async (vars) => {
      setPendingIds((prev) => ({ ...prev, [vars.customerId]: true }));
      await Promise.all([
        utils.customers.list.cancel(listInput),
        utils.requests.list.cancel(),
      ]);

      const prevCustomers = utils.customers.list.getData(listInput);
      utils.customers.list.setData(listInput, (old) =>
        old?.map((item) =>
          item.id === vars.customerId ? { ...item, botPaused: vars.botPaused } : item,
        ),
      );

      return { prevCustomers };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevCustomers) utils.customers.list.setData(listInput, ctx.prevCustomers);
      setPendingIds((prev) => {
        if (!prev[vars.customerId]) return prev;
        const next = { ...prev };
        delete next[vars.customerId];
        return next;
      });
    },
    onSettled: (_data, _err, vars) => {
      if (vars?.customerId) {
        setPendingIds((prev) => {
          if (!prev[vars.customerId]) return prev;
          const next = { ...prev };
          delete next[vars.customerId];
          return next;
        });
      }
      utils.customers.list.invalidate(listInput);
      utils.requests.list.invalidate();
      utils.requests.stats.invalidate();
    },
  });

  // Get source counts for filter dropdown
  const { data: sourceCounts } = trpc.customers.getSourceCounts.useQuery();

  const filteredRows = useMemo(() => {
    let result = [...rows];

    // Filter by source
    if (sourceFilter !== "all") {
      result = result.filter((r) => r.source === sourceFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.name?.toLowerCase().includes(q) ||
          r.externalId.toLowerCase().includes(q) ||
          r.email?.toLowerCase().includes(q) ||
          r.phone?.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDir === "asc" ? -1 : 1;
      if (bVal == null) return sortDir === "asc" ? 1 : -1;

      if (aVal instanceof Date && bVal instanceof Date) {
        return sortDir === "asc"
          ? aVal.getTime() - bVal.getTime()
          : bVal.getTime() - aVal.getTime();
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDir === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });

    return result;
  }, [rows, sourceFilter, searchQuery, sortKey, sortDir]);

  const handleSort = (key: keyof CustomerRow) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ column }: { column: keyof CustomerRow }) => {
    if (sortKey !== column) return null;
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 border-b"
        style={{ borderColor: "var(--border)", padding: "24px 28px" }}
      >
        {/* Search */}
        <input
          type="text"
          placeholder="Search customers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
            width: 520,
            maxWidth: "60vw",
          }}
        />

        {/* Source Filter */}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as Source | "all")}
          className="px-3 py-2 rounded-lg border text-sm"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
            width: 180,
            marginLeft: 12,
          }}
        >
          <option value="all">All Sources ({rows.length})</option>
          {SUPPORTED_SOURCES.map((src) => {
            const count = sourceCounts?.[src] ?? 0;
            if (count === 0) return null;
            return (
              <option key={src} value={src}>
                {SOURCE_CONFIG[src].label} ({count})
              </option>
            );
          })}
        </select>

        <div style={{ marginLeft: "auto" }}>
          <p className="text-sm text-gray-500" style={{ whiteSpace: "nowrap" }}>
            {filteredRows.length} customer{filteredRows.length !== 1 ? "s" : ""}
            {sourceFilter !== "all" && ` from ${SOURCE_CONFIG[sourceFilter].label}`}
          </p>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
        <table className="w-full text-sm">
          <thead>
            <tr
              className="border-b"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <th
                className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-gray-100/50"
                onClick={() => handleSort("source")}
              >
                Source <SortIcon column="source" />
              </th>
              <th
                className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-gray-100/50"
                onClick={() => handleSort("name")}
              >
                Customer <SortIcon column="name" />
              </th>
              <th
                className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-gray-100/50"
                onClick={() => handleSort("totalRequests")}
              >
                Requests <SortIcon column="totalRequests" />
              </th>
              <th className="px-4 py-3 text-left font-medium">Bot</th>
              <th
                className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-gray-100/50"
                onClick={() => handleSort("totalRevenue")}
              >
                Revenue <SortIcon column="totalRevenue" />
              </th>
              <th
                className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-gray-100/50"
                onClick={() => handleSort("leadScore")}
              >
                Lead Score <SortIcon column="leadScore" />
              </th>
              <th
                className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-gray-100/50"
                onClick={() => handleSort("lastSentiment")}
              >
                Sentiment <SortIcon column="lastSentiment" />
              </th>
              <th
                className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-gray-100/50"
                onClick={() => handleSort("lastMessageAt")}
              >
                Last Active <SortIcon column="lastMessageAt" />
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onSelect(row.id)}
                className="border-b cursor-pointer transition-colors hover:bg-gray-50/50"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="px-4 py-3">
                  <SourceBadge source={row.source} />
                </td>
                <td className="px-4 py-3">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {row.name || row.externalId}
                      {row.isHighIntent && (
                        <span title="High Intent" className="text-yellow-500">
                          ⭐
                        </span>
                      )}
                    </div>
                    {row.name && (
                      <div className="text-xs text-gray-500">{row.externalId}</div>
                    )}
                    {row.email && (
                      <div className="text-xs text-gray-400">{row.email}</div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium">{row.totalRequests}</span>
                </td>
                <td className="px-4 py-3">
                  {(() => {
                    const isPending = Boolean(pendingIds[row.id]);
                    return (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isPending) return;
                      togglePause.mutate({ customerId: row.id, botPaused: !row.botPaused });
                    }}
                    disabled={isPending}
                    style={{ opacity: isPending ? 0.6 : 1, width: 112, justifyContent: "center" }}
                  >
                    <span style={{ width: 16, height: 16 }}>{row.botPaused ? Icons.play : Icons.pause}</span>
                    {row.botPaused ? "Resume" : "Pause"}
                  </button>
                    );
                  })()}
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium">
                    ${parseFloat(row.totalRevenue || "0").toLocaleString()}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <LeadScoreBar score={row.leadScore} />
                </td>
                <td className="px-4 py-3">
                  <SentimentBadge sentiment={row.lastSentiment} />
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {row.lastMessageAt
                    ? new Date(row.lastMessageAt).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredRows.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {searchQuery || sourceFilter !== "all"
              ? "No customers match your filters"
              : "No customers found"}
          </div>
        )}

        {hasMore && (
          <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", textAlign: "center" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
