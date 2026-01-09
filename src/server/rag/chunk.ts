export function chunkText(text: string, opts?: { chunkSize?: number; overlap?: number }): string[] {
  const chunkSize = Math.max(1, opts?.chunkSize ?? 900);
  const overlap = Math.max(0, Math.min(opts?.overlap ?? 120, chunkSize - 1));
  const step = Math.max(1, chunkSize - overlap);

  const src = (text || "").trim();
  if (!src) return [];

  const out: string[] = [];
  for (let start = 0; start < src.length; start += step) {
    const end = Math.min(start + chunkSize, src.length);
    out.push(src.slice(start, end));
    if (end >= src.length) break;
  }
  return out;
}
