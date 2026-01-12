export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function percent(n: number, d: number) {
  if (!d || d <= 0) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

export function formatMoney(value: unknown) {
  const n = Number(value ?? 0);
  return `$${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

export function formatMaybeDate(value: unknown) {
  if (!value) return "—";
  const d = new Date(value as any);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function statusColors(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  if (s.includes("resolved") || s.includes("done") || s.includes("closed")) {
    return { bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.35)", text: "rgb(34,197,94)" };
  }
  if (s.includes("open") || s.includes("pending") || s.includes("new") || s.includes("in")) {
    return { bg: "rgba(0,180,255,0.14)", border: "rgba(0,180,255,0.35)", text: "rgb(0,180,255)" };
  }
  if (s.includes("reject") || s.includes("fail") || s.includes("cancel")) {
    return { bg: "rgba(239,68,68,0.14)", border: "rgba(239,68,68,0.35)", text: "rgb(239,68,68)" };
  }
  return { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.28)", text: "rgb(148,163,184)" };
}

export function parseSummary(value: unknown): { kind: "list"; items: string[] } | { kind: "text"; text: string } {
  if (value == null) return { kind: "text", text: "" };

  // Helper to clean individual items
  const cleanItem = (s: string): string => {
    return s
      .trim()
      .replace(/^["']|["']$/g, "") // Remove surrounding quotes
      .replace(/^[-•\s]+/, "") // Remove leading dashes, bullets, spaces
      .trim();
  };

  if (Array.isArray(value)) {
    const items = value
      .map((v) => cleanItem(String(v ?? "")))
      .filter(Boolean);
    return items.length ? { kind: "list", items } : { kind: "text", text: "" };
  }

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return { kind: "text", text: "" };

    // If summary is stored as a JSON string of an array, parse it.
    if (s.startsWith("[") && s.endsWith("]")) {
      // Try standard JSON first
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parseSummary(parsed);
        }
      } catch {
        // If the array uses single quotes or other formats, fall back to a tolerant parser
        const inner = s.slice(1, -1).trim();
        if (inner.length) {
          // Split by comma, but not inside quotes
          const items: string[] = [];
          let current = "";
          let inQuote = false;
          let quoteChar = "";
          
          for (let i = 0; i < inner.length; i++) {
            const char = inner[i];
            if ((char === '"' || char === "'") && !inQuote) {
              inQuote = true;
              quoteChar = char;
            } else if (char === quoteChar && inQuote) {
              inQuote = false;
              quoteChar = "";
            } else if (char === "," && !inQuote) {
              const cleaned = cleanItem(current);
              if (cleaned) items.push(cleaned);
              current = "";
              continue;
            }
            current += char;
          }
          // Don't forget the last item
          const cleaned = cleanItem(current);
          if (cleaned) items.push(cleaned);
          
          if (items.length) return { kind: "list", items };
        }
      }
    }

    // If it's a newline-delimited list, show bullets.
    const lines = s
      .split(/\r?\n/)
      .map((l) => cleanItem(l))
      .filter(Boolean);
    if (lines.length >= 2) return { kind: "list", items: lines };

    return { kind: "text", text: s };
  }

  return { kind: "text", text: String(value) };
}