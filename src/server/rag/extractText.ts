import mammoth from "mammoth";

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
    // pdf-parse v2 uses PDFParse class constructor
    const pdfParseModule: any = await import("pdf-parse");
    const PDFParse = pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse;
    
    if (!PDFParse) {
      throw new Error("pdf-parse PDFParse class not found in module");
    }
    
    // Create parser instance with buffer data
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    
    const rawText = result.text || "";
    const normalized = normalizeText(rawText);
    
    console.log(`[rag:extract] pdf pages=${result.numpages} rawChars=${rawText.length} normalizedChars=${normalized.length} sample="${normalized.slice(0, 100)}"`);
    
    return {
      text: normalized,
      pageCount: result.numpages || undefined,
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
