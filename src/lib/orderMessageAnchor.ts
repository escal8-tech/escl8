function asMetaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const ORDER_END_ANCHOR_KINDS = new Set([
  "order2_invoice",
  "order2_tracking_link",
  "order2_payment_pending",
  "order2_payment_finalize_failed",
  "order2_inventory_shortage",
]);

export function readOrderIdFromMessageMeta(meta: unknown): string | null {
  const record = asMetaRecord(meta);
  const orderAnchor = asMetaRecord(record.orderAnchor);
  const orderId = String(orderAnchor.orderId || "").trim();
  if (orderId) return orderId;

  const sourceMeta = asMetaRecord(record.sourceMeta);
  const sourceOrderId = String(sourceMeta.orderId || "").trim();
  if (sourceOrderId) return sourceOrderId;

  if (String(record.entityType || "").trim().toLowerCase() === "order") {
    const entityId = String(record.entityId || "").trim();
    if (entityId) return entityId;
  }

  return null;
}

export function isOrderEndAnchorMeta(meta: unknown): boolean {
  const record = asMetaRecord(meta);
  const orderAnchor = asMetaRecord(record.orderAnchor);
  if (String(orderAnchor.milestone || "").trim() === "order_end") return true;

  const sourceMeta = asMetaRecord(record.sourceMeta);
  const kind = String(sourceMeta.kind || "").trim().toLowerCase();
  return ORDER_END_ANCHOR_KINDS.has(kind);
}