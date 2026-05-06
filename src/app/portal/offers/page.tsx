"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import { TableSearchControl } from "@/app/portal/components/TableToolbarControls";
import { StockMappingWarning } from "@/app/portal/components/StockMappingWarning";
import { useToast } from "@/components/ToastProvider";
import type { StockMappingStatus } from "@/lib/stock-settings";

type OfferRow = {
  id: string;
  productId: string;
  productName?: string | null;
  title: string;
  originalPriceText?: string | null;
  offerPriceText: string;
  currency: string;
  notes?: string | null;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
};

type ItemOption = {
  id: string;
  name: string;
  priceOptions: Array<{ label: string; valueText: string }>;
};

function toLocalInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export default function OffersPage() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [itemSearch, setItemSearch] = useState("");
  const deferredItemSearch = useDeferredValue(itemSearch);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("Offer");
  const [originalPriceText, setOriginalPriceText] = useState("");
  const [offerPriceText, setOfferPriceText] = useState("");
  const [currency, setCurrency] = useState("LKR");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const itemsQuery = trpc.inventory.listItems.useQuery({
    search: deferredItemSearch.trim() || undefined,
    limit: 50,
    offset: 0,
    sortKey: "name",
    sortDir: "asc",
  });
  const offersQuery = trpc.inventory.listOffers.useQuery({ includeInactive: true, limit: 100, offset: 0 });
  const upsertOffer = trpc.inventory.upsertOffer.useMutation({
    onSuccess: () => {
      toast.show({ type: "success", title: "Offer saved", message: "The bot will use it while it is active.", durationMs: 3000 });
      clearForm();
      void utils.inventory.listOffers.invalidate();
      void utils.inventory.listItems.invalidate();
    },
    onError: (error) => {
      toast.show({ type: "error", title: "Offer save failed", message: error.message, durationMs: 5000 });
    },
  });
  const deleteOffer = trpc.inventory.deleteOffer.useMutation({
    onSuccess: () => {
      toast.show({ type: "success", title: "Offer deleted", message: "Offer removed.", durationMs: 2500 });
      void utils.inventory.listOffers.invalidate();
      void utils.inventory.listItems.invalidate();
    },
    onError: (error) => {
      toast.show({ type: "error", title: "Delete failed", message: error.message, durationMs: 5000 });
    },
  });

  const itemOptions = useMemo(() => {
    return ((itemsQuery.data?.items ?? []) as ItemOption[]).map((item) => ({
      value: item.id,
      label: item.name,
    }));
  }, [itemsQuery.data?.items]);

  const selectedItem = ((itemsQuery.data?.items ?? []) as ItemOption[]).find((item) => item.id === productId);
  const offers = (offersQuery.data?.items ?? []) as OfferRow[];
  const mappingStatus = itemsQuery.data?.mappingStatus as StockMappingStatus | undefined;

  function clearForm() {
    setEditingId(undefined);
    setProductId("");
    setTitle("Offer");
    setOriginalPriceText("");
    setOfferPriceText("");
    setCurrency("LKR");
    setNotes("");
    setIsActive(true);
    setStartsAt("");
    setEndsAt("");
  }

  function editOffer(offer: OfferRow) {
    setEditingId(offer.id);
    setProductId(offer.productId);
    setTitle(offer.title || "Offer");
    setOriginalPriceText(offer.originalPriceText || "");
    setOfferPriceText(offer.offerPriceText || "");
    setCurrency(offer.currency || "LKR");
    setNotes(offer.notes || "");
    setIsActive(Boolean(offer.isActive));
    setStartsAt(toLocalInputValue(offer.startsAt));
    setEndsAt(toLocalInputValue(offer.endsAt));
    if (offer.productName) setItemSearch(offer.productName);
  }

  const canSave = productId && offerPriceText.trim();

  return (
    <main className="portal-page-shell portal-offers-page">
      <div className="portal-page-stack">
        <StockMappingWarning status={mappingStatus} surface="offers" />
        <div className="portal-offers-layout">
          <section className="portal-offers-form">
            <div className="portal-offers-form__head">
              <div>
                <h2>{editingId ? "Edit Offer" : "Create Offer"}</h2>
                <p>Attach a temporary price to one stock item.</p>
              </div>
              {editingId ? (
                <button type="button" className="btn btn-secondary" onClick={clearForm}>New</button>
              ) : null}
            </div>

            <label className="portal-form-field">
              <span>Find item</span>
              <TableSearchControl value={itemSearch} onChange={setItemSearch} placeholder="Search items..." />
            </label>

            <label className="portal-form-field">
              <span>Item</span>
              <PortalSelect
                value={productId}
                onValueChange={(value) => {
                  setProductId(value);
                  const item = ((itemsQuery.data?.items ?? []) as ItemOption[]).find((row) => row.id === value);
                  const firstPrice = item?.priceOptions?.[0]?.valueText || "";
                  if (firstPrice && !originalPriceText) setOriginalPriceText(firstPrice);
                }}
                options={itemOptions}
                placeholder="Select item"
                ariaLabel="Offer item"
              />
            </label>

            {selectedItem?.priceOptions?.length ? (
              <div className="portal-offers-current-prices">
                {selectedItem.priceOptions.slice(0, 4).map((price) => (
                  <button
                    type="button"
                    key={`${price.label}-${price.valueText}`}
                    onClick={() => setOriginalPriceText(price.valueText)}
                  >
                    {price.label}: {price.valueText}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="portal-offers-form__grid">
              <label className="portal-form-field">
                <span>Title</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="portal-form-field">
                <span>Currency</span>
                <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
              </label>
              <label className="portal-form-field">
                <span>Original price</span>
                <input value={originalPriceText} onChange={(event) => setOriginalPriceText(event.target.value)} placeholder="4,500" />
              </label>
              <label className="portal-form-field">
                <span>Offer price</span>
                <input value={offerPriceText} onChange={(event) => setOfferPriceText(event.target.value)} placeholder="3,990" />
              </label>
              <label className="portal-form-field">
                <span>Starts</span>
                <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
              </label>
              <label className="portal-form-field">
                <span>Ends</span>
                <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
              </label>
            </div>

            <label className="portal-form-field">
              <span>Notes</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
            </label>

            <label className="portal-checkbox-row">
              <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              <span>Active</span>
            </label>

            <div className="portal-offers-form__actions">
              <button type="button" className="btn btn-secondary" onClick={clearForm}>Clear</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canSave || upsertOffer.isPending}
                onClick={() => upsertOffer.mutate({
                  id: editingId,
                  productId,
                  title,
                  originalPriceText,
                  offerPriceText,
                  currency,
                  notes,
                  isActive,
                  startsAt: startsAt || null,
                  endsAt: endsAt || null,
                })}
              >
                {upsertOffer.isPending ? "Saving..." : "Save Offer"}
              </button>
            </div>
          </section>

          <section className="portal-table-surface portal-offers-list">
            <div className="portal-items-toolbar">
              <div>
                <div className="portal-ledger-toolbar__title">Offers</div>
                <p className="portal-meta-text">{offersQuery.data?.totalCount ?? 0} offer{offersQuery.data?.totalCount === 1 ? "" : "s"}</p>
              </div>
            </div>
            <div className="portal-table-scroll">
              <table className="table portal-modern-table portal-mobile-cards">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Price</th>
                    <th>Window</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer) => (
                    <tr key={offer.id}>
                      <td data-label="Item">
                        <div className="portal-items-name">{offer.productName || "Item"}</div>
                        <div className="portal-items-meta">{offer.title}</div>
                      </td>
                      <td data-label="Price">
                        <div className="portal-items-price-row">
                          <span className="portal-items-offer-chip">{offer.offerPriceText}</span>
                          {offer.originalPriceText ? <span className="portal-items-old-price">{offer.originalPriceText}</span> : null}
                        </div>
                      </td>
                      <td data-label="Window" className="portal-items-meta">
                        {[offer.startsAt ? new Date(offer.startsAt).toLocaleDateString() : "Now", offer.endsAt ? new Date(offer.endsAt).toLocaleDateString() : "Open"].join(" - ")}
                      </td>
                      <td data-label="Status">{offer.isActive ? "Active" : "Inactive"}</td>
                      <td data-label="Actions">
                        <div className="portal-offers-actions">
                          <button type="button" className="btn btn-secondary" onClick={() => editOffer(offer)}>Edit</button>
                          <button type="button" className="btn btn-secondary" onClick={() => deleteOffer.mutate({ id: offer.id })}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!offersQuery.isLoading && offers.length === 0 ? (
                    <tr><td colSpan={5}>No offers created.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
