"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { useToast } from "@/components/ToastProvider";
import {
  STOCK_COLUMN_ROLES,
  friendlyStockColumnLabel,
  type StockColumnRole,
} from "@/lib/stock-settings";
import { PortalSelect } from "@/app/portal/components/PortalSelect";

type ColumnDraft = {
  key: string;
  label: string;
  role: StockColumnRole;
  priceLabel?: string;
  count: number;
  samples: string[];
};

const roleOptions = STOCK_COLUMN_ROLES.map((role) => ({
  value: role,
  label: role
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase()),
}));

const SINGLE_VALUE_ROLES = new Set<StockColumnRole>([
  "name",
  "item_code",
  "description",
  "category",
  "brand",
  "model",
  "image",
  "document",
  "quantity",
]);

export function StockSettingsPanel() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const mappingQuery = trpc.inventory.getColumnMapping.useQuery();
  const saveMapping = trpc.inventory.saveColumnMapping.useMutation({
    onSuccess: (result) => {
      toast.show({
        type: "success",
        title: "Stock mapping saved",
        message: `${result.appliedCount} item${result.appliedCount === 1 ? "" : "s"} updated.`,
        durationMs: 3000,
      });
      void utils.inventory.getColumnMapping.invalidate();
      void utils.inventory.listItems.invalidate();
    },
    onError: (error) => {
      toast.show({
        type: "error",
        title: "Stock mapping failed",
        message: error.message,
        durationMs: 5000,
      });
    },
  });

  const remoteColumns = useMemo<ColumnDraft[]>(() => {
    return (mappingQuery.data?.columns ?? []).map((column) => ({
      key: column.key,
      label: column.label || friendlyStockColumnLabel(column.key),
      role: column.role as StockColumnRole,
      priceLabel: column.priceLabel || "",
      count: column.count,
      samples: column.samples ?? [],
    }));
  }, [mappingQuery.data?.columns]);
  const [draftByKey, setDraftByKey] = useState<Record<string, Partial<ColumnDraft>>>({});
  const columns = useMemo(
    () => remoteColumns.map((column) => ({ ...column, ...(draftByKey[column.key] ?? {}) })),
    [draftByKey, remoteColumns],
  );

  const mappedCounts = useMemo(() => {
    const priceCount = columns.filter((column) => column.role === "price").length;
    const hasName = columns.some((column) => column.role === "name");
    const hasQuantity = columns.some((column) => column.role === "quantity");
    return { priceCount, hasName, hasQuantity };
  }, [columns]);

  const updateColumn = (key: string, patch: Partial<ColumnDraft>) => {
    setDraftByKey((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...patch } }));
  };

  const updateColumnRole = (key: string, role: StockColumnRole) => {
    setDraftByKey((prev) => {
      const next: Record<string, Partial<ColumnDraft>> = {
        ...prev,
        [key]: { ...(prev[key] ?? {}), role, ...(role === "price" ? {} : { priceLabel: "" }) },
      };
      if (SINGLE_VALUE_ROLES.has(role)) {
        for (const column of remoteColumns) {
          const currentRole = (prev[column.key]?.role ?? column.role) as StockColumnRole;
          if (column.key !== key && currentRole === role) {
            next[column.key] = { ...(next[column.key] ?? prev[column.key] ?? {}), role: "ignore", priceLabel: "" };
          }
        }
      }
      return next;
    });
  };

  return (
    <div className="portal-stock-settings">
      <div className="portal-stock-settings__summary">
        <div>
          <div className="portal-stock-settings__title">Stock Columns</div>
          <div className="portal-stock-settings__meta">
            {mappingQuery.isLoading
              ? "Loading detected columns"
              : `${columns.length} column${columns.length === 1 ? "" : "s"} detected across ${mappingQuery.data?.productCount ?? 0} sampled item${mappingQuery.data?.productCount === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="portal-stock-settings__badges">
          <span className={`portal-stock-settings__badge${mappedCounts.hasName ? " is-good" : ""}`}>Name</span>
          <span className={`portal-stock-settings__badge${mappedCounts.priceCount > 0 ? " is-good" : ""}`}>{mappedCounts.priceCount} Prices</span>
          <span className={`portal-stock-settings__badge${mappedCounts.hasQuantity ? " is-good" : ""}`}>Quantity</span>
        </div>
      </div>

      <div className="portal-stock-settings__table-wrap">
        <table className="table portal-modern-table portal-stock-settings__table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Map to</th>
              <th>Price label</th>
              <th>Samples</th>
            </tr>
          </thead>
          <tbody>
            {columns.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)", padding: 20 }}>
                  Upload and train a stock list to detect columns.
                </td>
              </tr>
            ) : columns.map((column) => (
              <tr key={column.key}>
                <td data-label="Column">
                  <div className="portal-stock-settings__column-name">{column.label}</div>
                  <div className="portal-stock-settings__column-key">{column.key}</div>
                </td>
                <td data-label="Map to">
                  <PortalSelect
                    value={column.role}
                    onValueChange={(role) => updateColumnRole(column.key, role as StockColumnRole)}
                    options={roleOptions}
                    ariaLabel={`Map ${column.label}`}
                  />
                </td>
                <td data-label="Price label">
                  <input
                    className="portal-stock-settings__input"
                    value={column.priceLabel ?? ""}
                    onChange={(event) => updateColumn(column.key, { priceLabel: event.target.value })}
                    placeholder={column.role === "price" ? column.label : "-"}
                    disabled={column.role !== "price"}
                  />
                </td>
                <td data-label="Samples">
                  <div className="portal-stock-settings__samples">
                    {column.samples.length ? column.samples.join(" | ") : `${column.count} mapped row${column.count === 1 ? "" : "s"}`}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="portal-stock-settings__actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void mappingQuery.refetch()}
          disabled={mappingQuery.isFetching || saveMapping.isPending}
        >
          Refresh
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => saveMapping.mutate({ columns })}
          disabled={saveMapping.isPending || columns.length === 0}
        >
          {saveMapping.isPending ? "Saving..." : "Save Mapping"}
        </button>
      </div>
    </div>
  );
}
