import mammoth from "mammoth";

export type ExtractedDoc = {
  text: string;
  pageCount?: number;
  pages?: string[];  // Individual page texts for page-wise chunking
};

// Page boundary marker used when preserving page structure
export const PAGE_BOUNDARY = "\n\n---PAGE_BREAK---\n\n";

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
        const pageText = normalizeText(page.text || "");
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
          const pageText = normalizeText(p);
          if (pageText.length > 0) {
            pages.push(pageText);
          }
        }
      }
    }
    
    // Build combined text with page boundaries preserved
    const textWithBoundaries = pages.length > 1 
      ? pages.join(PAGE_BOUNDARY)
      : normalizeText(rawText);
    
    const normalized = pages.length > 1 ? textWithBoundaries : normalizeText(rawText);
    
    console.log(`[rag:extract] pdf pages=${result.numpages} extractedPages=${pages.length} rawChars=${rawText.length} normalizedChars=${normalized.length} sample="${normalized.slice(0, 100)}"`);
    
    return {
      text: normalized,
      pageCount: result.numpages || pages.length || undefined,
      pages: pages.length > 0 ? pages : undefined,
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
