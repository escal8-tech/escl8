import mammoth from "mammoth";

// pdf-parse exports vary between CJS/ESM; this runtime-safe import pattern works in Node.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse: any = require("pdf-parse");

export type ExtractedDoc = {
  text: string;
  pageCount?: number;
};

function normalizeText(t: string): string {
  return (t || "").replace(/\s+/g, " ").trim();
}

export async function extractTextFromBuffer(params: {
  buffer: Buffer;
  filename: string;
  contentType?: string;
}): Promise<ExtractedDoc> {
  const { buffer, filename } = params;
  const lower = filename.toLowerCase();
  const contentType = (params.contentType || "").toLowerCase();

  if (lower.endsWith(".pdf") || contentType === "application/pdf") {
    const parsed = await pdfParse(buffer);
    return {
      text: normalizeText(parsed.text || ""),
      pageCount: parsed.numpages || undefined,
    };
  }

  if (lower.endsWith(".docx") || contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const res = await mammoth.extractRawText({ buffer });
    return { text: normalizeText(res.value || "") };
  }

  // Basic plaintext/csv
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".csv") ||
    contentType.startsWith("text/") ||
    contentType === "application/json"
  ) {
    return { text: normalizeText(buffer.toString("utf8")) };
  }

  // Legacy .doc (binary) is not supported here.
  throw new Error(`Unsupported document type for extraction: ${filename} (${contentType || "unknown"})`);
}
