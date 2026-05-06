export function isDeliveryLineItemName(value: unknown): boolean {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;
  return /^(?:free )?(?:delivery|shipping|courier)(?: (?:fee|charge|cost|free|included))?$/.test(normalized);
}
