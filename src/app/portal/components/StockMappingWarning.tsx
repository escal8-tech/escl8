"use client";

import Link from "next/link";
import type { StockMappingStatus } from "@/lib/stock-settings";

type StockMappingWarningProps = {
  status?: StockMappingStatus | null;
  surface?: "items" | "offers";
};

export function StockMappingWarning({ status, surface = "items" }: StockMappingWarningProps) {
  if (!status || status.isReady) return null;

  const title = !status.isMapped
    ? "Stock columns are not mapped yet"
    : !status.hasName
      ? "Map one item name column"
      : "Map at least one price column";
  const fallbackCopy = surface === "offers"
    ? "Offers can be created after the item and price columns are mapped."
    : "Items are shown with fallback detection until the stock map is saved.";

  return (
    <section className="portal-setup-warning" aria-label="Stock mapping setup warning">
      <div>
        <div className="portal-setup-warning__title">{title}</div>
        <p>{fallbackCopy} Quantity, image, and document columns can be mapped when available.</p>
      </div>
      <Link className="btn btn-primary portal-setup-warning__action" href="/settings?tab=stock">
        Map Stock Columns
      </Link>
    </section>
  );
}
