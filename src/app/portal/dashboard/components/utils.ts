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

  if (Array.isArray(value)) {
    const items = value
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      // tolerate items already starting with a dash
      .map((s) => (s.startsWith("- ") ? s.slice(2) : s));
    return { kind: "list", items };
  }

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return { kind: "text", text: "" };

    // If summary is stored as a JSON string of an array, parse it.
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parseSummary(parsed);
        }
      } catch {
        // ignore; fall through to plain text
      }
    }

    // If it's a newline-delimited list, show bullets.
    const lines = s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (l.startsWith("- ") ? l.slice(2) : l));
    if (lines.length >= 2) return { kind: "list", items: lines };

    return { kind: "text", text: s };
  }

  return { kind: "text", text: String(value) };
}