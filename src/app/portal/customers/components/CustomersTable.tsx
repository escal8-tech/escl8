"use client";

import { useMemo, useState } from "react";
import { CustomerRow, Source, SOURCE_CONFIG } from "../types";
import { SUPPORTED_SOURCES } from "@/../drizzle/schema";
import { trpc } from "@/utils/trpc";
import { TableSelect } from "@/app/portal/components/TableToolbarControls";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { PortalBotToggleButton } from "@/app/portal/components/PortalBotToggleButton";
import { useRouter } from "next/navigation";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";

interface Props {
  rows: CustomerRow[];
  onSelect: (id: string) => void;
  listInput?: { whatsappIdentityId?: string };
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}
const PAGE_SIZE = 20;

function SourceBadge({ source }: { source: Source }) {
  const config = SOURCE_CONFIG[source];
  return (
    <span
      className="inline-block"
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        background: `${config.color}24`,
        color: "#e2e8f0",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "0.01em",
      }}
    >
      {config.label}
    </span>
  );
}

export function CustomersTable({ rows, onSelect, listInput, hasMore, isLoadingMore, onLoadMore }: Props) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<Source | "all">("all");
  const [sortKey, setSortKey] = useState<keyof CustomerRow>("lastMessageAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [botPausedOverrides, setBotPausedOverrides] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);

  const utils = trpc.useUtils();
  const togglePause = trpc.customers.setBotPaused.useMutation({
    onMutate: async (vars) => {
      setPendingIds((prev) => ({ ...prev, [vars.customerId]: true }));
      setBotPausedOverrides((prev) => ({ ...prev, [vars.customerId]: vars.botPaused }));
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
      setBotPausedOverrides((prev) => {
        if (!(vars.customerId in prev)) return prev;
        const next = { ...prev };
        delete next[vars.customerId];
        return next;
      });
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
        setBotPausedOverrides((prev) => {
          if (!(vars.customerId in prev)) return prev;
          const next = { ...prev };
          delete next[vars.customerId];
          return next;
        });
      }
      utils.customers.list.invalidate();
      utils.requests.list.invalidate();
      utils.requests.stats.invalidate();
    },
  });

  const { data: sourceCounts } = trpc.customers.getSourceCounts.useQuery();

  const filteredRows = useMemo(() => {
    let result = [...rows];

    if (sourceFilter !== "all") {
      result = result.filter((r) => r.source === sourceFilter);
    }

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
  const totalPagesLoaded = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPagesLoaded - 1);
  const pageRows = useMemo(
    () => filteredRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filteredRows, safePage],
  );

  const handleSort = (key: keyof CustomerRow) => {
    setPage(0);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (column: keyof CustomerRow) => {
    if (sortKey !== column) return null;
    return <span className="ml-1">{sortDir === "asc" ? "^" : "v"}</span>;
  };

  const getThreadHref = (row: CustomerRow) => {
    const params = new URLSearchParams();
    if (row.id) params.set("customerId", row.id);
    else if (row.phone) params.set("phone", row.phone);
    const query = params.toString();
    return query ? `/messages?${query}` : "/messages";
  };

  return (
    <PortalDataTable
      toolbarNoWrap
      search={{
        value: searchQuery,
        onChange: (value) => {
          setSearchQuery(value);
          setPage(0);
        },
        placeholder: "Search customers...",
        style: { width: "min(520px, 52vw)", minWidth: 220, flex: "0 1 520px" },
      }}
      countText={`${filteredRows.length} customer${filteredRows.length !== 1 ? "s" : ""}${sourceFilter !== "all" ? ` from ${SOURCE_CONFIG[sourceFilter].label}` : ""}`}
      endControls={(
        <TableSelect
          value={sourceFilter}
          onChange={(e) => {
            setSourceFilter(e.target.value as Source | "all");
            setPage(0);
          }}
          style={{ width: 132 }}
        >
          <option value="all">All sources ({rows.length})</option>
          {SUPPORTED_SOURCES.map((src) => {
            const count = sourceCounts?.[src] ?? 0;
            if (count === 0) return null;
            return (
              <option key={src} value={src}>
                {SOURCE_CONFIG[src].label} ({count})
              </option>
            );
          })}
        </TableSelect>
      )}
      footer={(
        <TablePagination
          page={safePage}
          totalPages={totalPagesLoaded}
          shownCount={pageRows.length}
          totalCount={filteredRows.length}
          canPrev={safePage > 0}
          canNext={safePage < totalPagesLoaded - 1 || Boolean(hasMore)}
          pageLabelSuffix={hasMore ? "+" : undefined}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => {
            if (safePage < totalPagesLoaded - 1) {
              setPage((p) => p + 1);
              return;
            }
            if (hasMore && onLoadMore && !isLoadingMore) {
              onLoadMore();
            }
          }}
          onPageChange={setPage}
        />
      )}
    >
      <table className="table table-clickable portal-modern-table portal-mobile-cards">
        <thead>
          <tr>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("source")}>
              Source {sortIndicator("source")}
            </th>
            <th style={{ width: 72, textAlign: "center" }}>Bot</th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("name")}>
              Customer {sortIndicator("name")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("lastMessageAt")}>
              Last active {sortIndicator("lastMessageAt")}
            </th>
            <th style={{ width: 56 }} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr key={row.id} onClick={() => onSelect(row.id)}>
              <td data-label="Source" style={{ paddingTop: 14, paddingBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <SourceBadge source={row.source} />
                </div>
              </td>
              <td data-label="Bot" style={{ textAlign: "center" }}>
                {(() => {
                  const isPending = Boolean(pendingIds[row.id]);
                  const paused = botPausedOverrides[row.id] ?? Boolean(row.botPaused);
                  return (
                    <PortalBotToggleButton
                      paused={paused}
                      pending={isPending}
                      onToggle={() => togglePause.mutate({ customerId: row.id, botPaused: !paused })}
                    />
                  );
                })()}
              </td>
              <td data-label="Customer">
                <div>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                    {row.name || row.externalId}
                    {row.isHighIntent && (
                      <span title="High Intent" style={{ color: "#f59e0b", fontSize: 13 }}>
                        *
                      </span>
                    )}
                  </div>
                  {row.name && (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{row.externalId}</div>
                  )}
                  {row.email && (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{row.email}</div>
                  )}
                </div>
              </td>
              <td data-label="Last Active" style={{ color: "var(--muted)" }}>
                {row.lastMessageAt
                  ? new Date(row.lastMessageAt).toLocaleDateString()
                  : "-"}
              </td>
              <td
                data-label="Actions"
                style={{ textAlign: "center" }}
                onClick={(e) => e.stopPropagation()}
              >
                <RowActionsMenu
                  items={[
                    {
                      label: "Open Thread",
                      onSelect: () => {
                        router.push(getThreadHref(row));
                      },
                    },
                  ]}
                />
              </td>
            </tr>
          ))}

          {pageRows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: "24px 10px" }}>
                {searchQuery || sourceFilter !== "all"
                  ? "No customers match your filters"
                  : "No customers found"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </PortalDataTable>
  );
}
