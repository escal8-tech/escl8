export function parseMoneyNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value == null) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[^0-9.,-]/g, "");
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;

  const negative = cleaned.trim().startsWith("-");
  const unsigned = cleaned.replace(/-/g, "");
  const lastDot = unsigned.lastIndexOf(".");
  const lastComma = unsigned.lastIndexOf(",");
  let normalized = unsigned;

  if (lastDot >= 0 && lastComma >= 0) {
    normalized = lastComma > lastDot
      ? unsigned.replace(/\./g, "").replace(/,/g, ".")
      : unsigned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const parts = unsigned.split(",");
    const looksLikeThousands = parts.length > 1
      && /^\d{1,3}$/.test(parts[0] ?? "")
      && parts.slice(1).every((part) => /^\d{3}$/.test(part));
    normalized = looksLikeThousands ? parts.join("") : parts.join(".");
  } else if (lastDot >= 0) {
    const parts = unsigned.split(".");
    const looksLikeThousands = parts.length > 1
      && /^\d{1,3}$/.test(parts[0] ?? "")
      && parts.slice(1).every((part) => /^\d{3}$/.test(part));
    normalized = looksLikeThousands ? parts.join("") : unsigned;
  }

  const parsed = Number(`${negative ? "-" : ""}${normalized}`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoneyDecimal(value: unknown): string | null {
  const parsed = parseMoneyNumber(value);
  return parsed == null ? null : parsed.toFixed(2);
}
