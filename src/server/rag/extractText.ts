/* eslint-disable @typescript-eslint/no-explicit-any */
import mammoth from "mammoth";

export type ExtractedDoc = {
  text: string;
  pageCount?: number;
  pages?: string[];  // Individual page texts for page-wise chunking
  rows?: string[];   // Row texts for spreadsheet row-wise chunking
  structuredRows?: SpreadsheetRow[]; // Row objects with normalized dynamic headers
};

export type SpreadsheetRow = {
  sheetName: string;
  rowNumber: number; // 1-based row number in source sheet
  fields: Record<string, string>;
  text: string; // Labeled row text for embedding
};

const PRODUCT_FIELD_PATTERNS = [
  /(^|_)product($|_)/i,
  /(^|_)item($|_)/i,
  /(^|_)description($|_)/i,
  /(^|_)model($|_)/i,
  /(^|_)name($|_)/i,
];

const CODE_FIELD_PATTERNS = [
  /(^|_)item_code($|_)/i,
  /(^|_)product_code($|_)/i,
  /(^|_)sku($|_)/i,
  /(^|_)code($|_)/i,
];

const SPEC_FIELD_PATTERNS = [
  /(^|_)spec($|_)/i,
  /(^|_)specification($|_)/i,
  /(^|_)details?($|_)/i,
];

const PRICE_FIELD_PATTERNS = [
  /(^|_)(retail|price|cost|member|wholesale|dealer|cash|offer|promo|warranty)($|_)/i,
];

function matchesAnyPattern(key: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(key));
}

function buildSpreadsheetRowText(fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  if (!entries.length) return "";

  const ordered: Array<[string, string]> = [];
  const seen = new Set<string>();

  const pushMatching = (patterns: RegExp[]) => {
    for (const [key, value] of entries) {
      if (!value || seen.has(key) || !matchesAnyPattern(key, patterns)) continue;
      ordered.push([key, value]);
      seen.add(key);
    }
  };

  pushMatching(CODE_FIELD_PATTERNS);
  pushMatching(PRODUCT_FIELD_PATTERNS);
  pushMatching(SPEC_FIELD_PATTERNS);

  for (const [key, value] of entries) {
    if (!value || seen.has(key) || matchesAnyPattern(key, PRICE_FIELD_PATTERNS)) continue;
    ordered.push([key, value]);
    seen.add(key);
  }

  for (const [key, value] of entries) {
    if (!value || seen.has(key)) continue;
    ordered.push([key, value]);
    seen.add(key);
  }

  return normalizeText(ordered.map(([k, v]) => `${k}: ${v}`).join(" | "));
}

// Page boundary marker used when preserving page structure
export const PAGE_BOUNDARY = "\n\n---PAGE_BREAK---\n\n";

function normalizeText(t: string): string {
  return (t || "").replace(/\s+/g, " ").trim();
}

function normalizeTextPreserveLines(t: string): string {
  return (t || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeHeaderKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function extractTextFromBuffer(params: {
  buffer: Buffer;
  filename: string;
  contentType?: string;
  preserveLineBreaks?: boolean;
}): Promise<ExtractedDoc> {
  const { buffer, filename } = params;
  const lower = filename.toLowerCase();
  const contentType = (params.contentType || "").toLowerCase();
  const normalize = params.preserveLineBreaks ? normalizeTextPreserveLines : normalizeText;

  if (lower.endsWith(".pdf") || contentType === "application/pdf") {
    // pdf-parse v2 uses PDFParse class constructor
    const pdfParseModule: any = await import("pdf-parse");
    const PDFParse = pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse;
    
    if (!PDFParse) {
      throw new Error("pdf-parse PDFParse class not found in module");
    }
    
    // Create parser instance with buffer data
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    
    // Extract per-page text if available
    const pages: string[] = [];
    if (result.pages && Array.isArray(result.pages)) {
      for (const page of result.pages) {
        const pageText = normalize(page.text || "");
        if (pageText.length > 0) {
          pages.push(pageText);
        }
      }
    }
    
    // If pages array wasn't populated, try splitting by form feed or page markers
    const rawText = result.text || "";
    if (pages.length === 0 && rawText.length > 0) {
      // Try to split by form feed (\f) which some PDFs use
      const ffSplit = rawText.split(/\f/);
      if (ffSplit.length > 1) {
        for (const p of ffSplit) {
          const pageText = normalize(p);
          if (pageText.length > 0) {
            pages.push(pageText);
          }
        }
      }
    }
    
    // Build combined text with page boundaries preserved
    const textWithBoundaries = pages.length > 1 
      ? pages.join(PAGE_BOUNDARY)
      : normalize(rawText);
    
    const normalized = pages.length > 1 ? textWithBoundaries : normalize(rawText);
    
    console.log(`[rag:extract] pdf pages=${result.numpages} extractedPages=${pages.length} rawChars=${rawText.length} normalizedChars=${normalized.length} sample="${normalized.slice(0, 100)}"`);
    
    return {
      text: normalized,
      pageCount: result.numpages || pages.length || undefined,
      pages: pages.length > 0 ? pages : undefined,
    };
  }

  if (lower.endsWith(".docx") || contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const res = await mammoth.extractRawText({ buffer });
    return { text: normalize(res.value || "") };
  }

  if (
    lower.endsWith(".xlsx") ||
    contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    const xlsx: any = await import("xlsx");
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const rowTexts: string[] = [];
    const structuredRows: SpreadsheetRow[] = [];

    for (const sheetName of workbook.SheetNames || []) {
      const sheet = workbook.Sheets?.[sheetName];
      if (!sheet) continue;
      const rows: unknown[][] = xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });

      const headerRowIndex = rows.findIndex((row) =>
        row.some((cell) => String(cell ?? "").trim().length > 0),
      );
      if (headerRowIndex < 0) continue;

      const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const rawHeaders = Array.from({ length: columnCount }, (_, idx) => String(rows[headerRowIndex]?.[idx] ?? "").trim());
      const normalizedHeaders = rawHeaders.map((header, idx) => {
        const key = normalizeHeaderKey(header);
        return key || `col${idx + 1}`;
      });

      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        const fields: Record<string, string> = {};

        for (let j = 0; j < normalizedHeaders.length; j++) {
          const key = normalizedHeaders[j];
          const value = String(row?.[j] ?? "").trim();
          if (!value) continue;
          fields[key] = value;
        }

        const finalText = buildSpreadsheetRowText(fields);
        if (!finalText) continue;

        rowTexts.push(finalText);
        structuredRows.push({
          sheetName,
          rowNumber: i + 1,
          fields,
          text: finalText,
        });
      }
    }

    return {
      text: rowTexts.join("\n"),
      pageCount: rowTexts.length || undefined,
      rows: rowTexts,
      structuredRows,
    };
  }

  // Basic plaintext/csv
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".csv") ||
    contentType.startsWith("text/") ||
    contentType === "application/json"
  ) {
    return { text: normalize(buffer.toString("utf8")) };
  }

  // Legacy .doc (binary) is not supported here.
  throw new Error(`Unsupported document type for extraction: ${filename} (${contentType || "unknown"})`);
}
