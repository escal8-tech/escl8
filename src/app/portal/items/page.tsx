"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { TableSearchControl } from "@/app/portal/components/TableToolbarControls";
import { StockMappingWarning } from "@/app/portal/components/StockMappingWarning";
import { useToast } from "@/components/ToastProvider";
import type { StockMappingStatus } from "@/lib/stock-settings";

const PAGE_SIZE = 24;

type InventoryItem = {
  id: string;
  itemCode?: string | null;
  name: string;
  specification?: string | null;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  quantityOnHand?: number | null;
  reservedQuantity?: number | null;
  availableQuantity?: number | null;
  quantityUnit?: string | null;
  priceOptions: Array<{ id: string; label: string; valueText: string; currency: string }>;
  activeOffer?: { title: string; originalPriceText?: string | null; offerPriceText: string; currency: string } | null;
};

function PriceChips({ item }: { item: InventoryItem }) {
  if (item.activeOffer) {
    return (
      <div className="portal-items-price-row">
        <span className="portal-items-offer-chip">{item.activeOffer.title || "Offer"}: {item.activeOffer.offerPriceText}</span>
        {item.activeOffer.originalPriceText ? (
          <span className="portal-items-old-price">{item.activeOffer.originalPriceText}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="portal-items-price-row">
      {item.priceOptions.slice(0, 4).map((price) => (
        <span key={price.id} className="portal-items-price-chip">{price.label}: {price.valueText}</span>
      ))}
      {item.priceOptions.length > 4 ? <span className="portal-items-muted-chip">+{item.priceOptions.length - 4}</span> : null}
    </div>
  );
}

function QuantityEditor({ item }: { item: InventoryItem }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState(item.quantityOnHand == null ? "" : String(item.quantityOnHand));
  const updateQuantity = trpc.inventory.updateItemQuantity.useMutation({
    onSuccess: () => {
      toast.show({ type: "success", title: "Quantity updated", message: item.name, durationMs: 2200 });
      void utils.inventory.listItems.invalidate();
    },
    onError: (error) => {
      toast.show({ type: "error", title: "Quantity update failed", message: error.message, durationMs: 5000 });
    },
  });

  const quantity = Number(draft);
  const canSave = Number.isInteger(quantity) && quantity >= 0 && quantity !== (item.quantityOnHand ?? -1);
  const hasReservation = Number(item.reservedQuantity ?? 0) > 0;
  const available = item.availableQuantity ?? item.quantityOnHand;

  return (
    <div className="portal-items-quantity-block">
      <div className="portal-items-quantity">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          aria-label={`Quantity for ${item.name}`}
          placeholder="-"
        />
        <span>{item.quantityUnit || "qty"}</span>
        <button
          type="button"
          className="btn btn-primary portal-items-quantity__save"
          disabled={!canSave || updateQuantity.isPending}
          onClick={() => updateQuantity.mutate({ productId: item.id, quantity })}
        >
          Save
        </button>
      </div>
      {hasReservation ? (
        <div className="portal-items-quantity-note">
          Available {available ?? "-"} / Held {item.reservedQuantity}
        </div>
      ) : null}
    </div>
  );
}

function ItemImage({ item }: { item: InventoryItem }) {
  if (!item.mediaUrl || item.mediaType !== "image") {
    return <div className="portal-items-image portal-items-image--empty">No image</div>;
  }
  return (
    <div className="portal-items-image">
      {/* Business stock sheets can contain arbitrary image hosts, so this stays as a plain image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.mediaUrl} alt={item.name} loading="lazy" />
    </div>
  );
}

function ItemCard({ item }: { item: InventoryItem }) {
  return (
    <article className="portal-items-card">
      <ItemImage item={item} />
      <div className="portal-items-card__body">
        <div className="portal-items-name">{item.name}</div>
        <div className="portal-items-meta">
          {[item.itemCode, item.brand, item.model, item.category].filter(Boolean).join(" | ") || "Uncategorized"}
        </div>
        {item.description || item.specification ? (
          <p className="portal-items-description">{item.description || item.specification}</p>
        ) : null}
        <PriceChips item={item} />
        <QuantityEditor key={`${item.id}-${item.quantityOnHand ?? "none"}`} item={item} />
      </div>
    </article>
  );
}

function ListRow({ item }: { item: InventoryItem }) {
  return (
    <tr>
      <td data-label="Item">
        <div className="portal-items-list-item">
          <ItemImage item={item} />
          <div>
            <div className="portal-items-name">{item.name}</div>
            <div className="portal-items-meta">
              {[item.itemCode, item.brand, item.model, item.category].filter(Boolean).join(" | ") || "Uncategorized"}
            </div>
          </div>
        </div>
      </td>
      <td data-label="Prices"><PriceChips item={item} /></td>
      <td data-label="Stock"><QuantityEditor key={`${item.id}-${item.quantityOnHand ?? "none"}`} item={item} /></td>
    </tr>
  );
}

function ViewToggle({ view, onChange }: { view: "grid" | "list"; onChange: (view: "grid" | "list") => void }) {
  return (
    <div className="portal-view-toggle" aria-label="View type">
      <button type="button" className={view === "grid" ? "is-active" : ""} onClick={() => onChange("grid")} aria-label="Grid view">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      <button type="button" className={view === "list" ? "is-active" : ""} onClick={() => onChange("list")} aria-label="List view">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      </button>
    </div>
  );
}

export default function ItemsPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"grid" | "list">("grid");

  const input = useMemo(() => ({
    search: deferredSearch.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    sortKey: "name" as const,
    sortDir: "asc" as const,
  }), [deferredSearch, page]);

  const itemsQuery = trpc.inventory.listItems.useQuery(input);
  const items = (itemsQuery.data?.items ?? []) as InventoryItem[];
  const mappingStatus = itemsQuery.data?.mappingStatus as StockMappingStatus | undefined;
  const totalCount = itemsQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);

  useEffect(() => {
    if (safePage !== page) {
      queueMicrotask(() => setPage(safePage));
    }
  }, [page, safePage]);

  return (
    <main className="portal-page-shell portal-items-page">
      <div className="portal-page-stack">
        <StockMappingWarning status={mappingStatus} surface="items" />
        <div className="portal-table-surface portal-items-surface">
          <div className="portal-items-toolbar">
            <div className="portal-items-toolbar__search">
              <TableSearchControl
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
                placeholder="Search items..."
              />
            </div>
            <div className="portal-items-toolbar__end">
              <p className="portal-meta-text">{totalCount} item{totalCount === 1 ? "" : "s"}</p>
              <ViewToggle view={view} onChange={setView} />
            </div>
          </div>

          {view === "grid" ? (
            <div className="portal-items-grid">
              {items.map((item) => <ItemCard key={item.id} item={item} />)}
              {!itemsQuery.isLoading && items.length === 0 ? (
                <div className="portal-items-empty">No items found.</div>
              ) : null}
            </div>
          ) : (
            <div className="portal-table-scroll">
              <table className="table portal-modern-table portal-mobile-cards portal-items-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Prices</th>
                    <th>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => <ListRow key={item.id} item={item} />)}
                  {!itemsQuery.isLoading && items.length === 0 ? (
                    <tr><td colSpan={3}>No items found.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          <TablePagination
            page={safePage}
            totalPages={totalPages}
            shownCount={items.length}
            totalCount={totalCount}
            canPrev={safePage > 0}
            canNext={safePage < totalPages - 1}
            onPrev={() => setPage(Math.max(0, safePage - 1))}
            onNext={() => setPage(Math.min(totalPages - 1, safePage + 1))}
            onPageChange={setPage}
            pageLabelSuffix="items"
          />
        </div>
      </div>
    </main>
  );
}
