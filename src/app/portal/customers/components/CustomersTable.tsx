"use client";

import { useState } from "react";
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
  totalCount: number;
  page: number;
  totalPages: number;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  sourceFilter: Source | "all";
  onSourceFilterChange: (value: Source | "all") => void;
  sortKey: "source" | "name" | "lastMessageAt";
  sortDir: "asc" | "desc";
  onSortChange: (key: "source" | "name" | "lastMessageAt") => void;
  onPageChange: (page: number) => void;
  onSelect: (id: string) => void;
  pageInput: {
    whatsappIdentityId?: string;
    limit: number;
    offset: number;
    search?: string;
    source?: Source;
    sortKey: "source" | "name" | "lastMessageAt";
    sortDir: "asc" | "desc";
  };
  countsInput?: { whatsappIdentityId?: string };
}

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

export function CustomersTable({
  rows,
  totalCount,
  page,
  totalPages,
  searchQuery,
  onSearchQueryChange,
  sourceFilter,
  onSourceFilterChange,
  sortKey,
  sortDir,
  onSortChange,
  onPageChange,
  onSelect,
  pageInput,
  countsInput,
}: Props) {
  const router = useRouter();
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [botPausedOverrides, setBotPausedOverrides] = useState<Record<string, boolean>>({});

  const utils = trpc.useUtils();
  const togglePause = trpc.customers.setBotPaused.useMutation({
    onMutate: async (vars) => {
      setPendingIds((prev) => ({ ...prev, [vars.customerId]: true }));
      setBotPausedOverrides((prev) => ({ ...prev, [vars.customerId]: vars.botPaused }));
      await Promise.all([
        utils.customers.listPage.cancel(pageInput),
        utils.requests.listPage.cancel(),
      ]);

      const prevCustomers = utils.customers.listPage.getData(pageInput);
      utils.customers.listPage.setData(pageInput, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((item) =>
            item.id === vars.customerId ? { ...item, botPaused: vars.botPaused } : item,
          ),
        };
      });

      return { prevCustomers };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevCustomers) utils.customers.listPage.setData(pageInput, ctx.prevCustomers);
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
      utils.customers.listPage.invalidate();
      utils.requests.list.invalidate();
      utils.requests.listPage.invalidate();
      utils.requests.stats.invalidate();
    },
  });

  const { data: sourceCounts } = trpc.customers.getSourceCounts.useQuery(countsInput);
  const safePage = Math.min(page, Math.max(totalPages, 1) - 1);

  const sortIndicator = (column: "source" | "name" | "lastMessageAt") => {
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
          onSearchQueryChange(value);
        },
        placeholder: "Search customers...",
        style: { width: "min(520px, 52vw)", minWidth: 220, flex: "0 1 520px" },
      }}
      countText={`${totalCount} customer${totalCount !== 1 ? "s" : ""}${sourceFilter !== "all" ? ` from ${SOURCE_CONFIG[sourceFilter].label}` : ""}`}
      endControls={(
        <TableSelect
          value={sourceFilter}
          onChange={(e) => {
            onSourceFilterChange(e.target.value as Source | "all");
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
          totalPages={totalPages}
          shownCount={rows.length}
          totalCount={totalCount}
          canPrev={safePage > 0}
          canNext={safePage < totalPages - 1}
          onPrev={() => onPageChange(Math.max(0, safePage - 1))}
          onNext={() => onPageChange(Math.min(totalPages - 1, safePage + 1))}
          onPageChange={onPageChange}
        />
      )}
    >
      <table className="table table-clickable portal-modern-table portal-mobile-cards">
        <thead>
          <tr>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSortChange("source")}>
              Source {sortIndicator("source")}
            </th>
            <th style={{ width: 72, textAlign: "center" }}>Bot</th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSortChange("name")}>
              Customer {sortIndicator("name")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSortChange("lastMessageAt")}>
              Last active {sortIndicator("lastMessageAt")}
            </th>
            <th style={{ width: 56 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
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

          {rows.length === 0 && (
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
