import crypto from "crypto";
import { downloadBlobToBuffer, uploadTextToBlob } from "./blob";
import { extractTextFromBuffer, PAGE_BOUNDARY } from "./extractText";
import { smartChunkText, classifyChunksWithLLM, SmartChunk } from "./smartChunk";
import { embedTexts } from "./embed";
import { getPineconeIndex } from "./pinecone";

export type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractPricesLite(text: string): string[] {
  const matches = text.match(/(?:RM|MYR|USD|US\\$|\\$|£|€|₹)\\s*[\\d,]+(?:\\.\\d{2})?/gi) || [];
  const unique = Array.from(new Set(matches.map(m => m.trim())));
  return unique.slice(0, 20);
}

function extractKeywordsLite(text: string): string[] {
  const words = text.toLowerCase().match(/\\b[a-z]{4,}\\b/g) || [];
  const stop = new Set(["this","that","with","from","have","been","were","will","would","could","should","their","there","which","about","into","more","other","some","such","than","then","these","they","through","very","your","also","each","just","like","make","when","only","where","what"]);
  const freq: Record<string, number> = {};
  for (const w of words) {
    if (stop.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w);
}

type Section = { title: string; text: string };

function splitIntoPages(text: string, pages?: string[]): string[] {
  if (pages && pages.length > 0) return pages;
  if (text.includes(PAGE_BOUNDARY)) return text.split(PAGE_BOUNDARY).map(p => p.trim()).filter(Boolean);
  return [text];
}

function isHeadingLine(line: string): boolean {
  const clean = line.replace(/[—–]/g, "-").trim();
  if (!clean) return false;
  if (/^[-=]{3,}$/.test(clean)) return false;
  if (/^\d+\.\s+/.test(clean)) return false;
  if (/^[-•]\s+/.test(clean)) return false;
  if (/^\d+\)\s+/.test(clean)) return true; // tours style
  if (clean.length > 80) return false;
  if (/^[A-Z][A-Z0-9 &/.-]{3,}$/.test(clean)) return true;
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,6}$/.test(clean)) return true;
  return false;
}

function buildSectionsFromPages(pages: string[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const page of pages) {
    const lines = page.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      if (isHeadingLine(line)) {
        if (current && current.text.trim().length > 0) {
          sections.push(current);
        }
        const title = line.replace(/^\d+\)\s+/, "").trim();
        current = { title, text: "" };
        continue;
      }
      if (!current) {
        current = { title: "Section", text: "" };
      }
      current.text += (current.text ? "\n" : "") + line;
    }
    if (current) {
      current.text += "\n";
    }
  }

  if (current && current.text.trim().length > 0) {
    sections.push(current);
  }

  return sections;
}

function buildConversationSections(text: string, pages?: string[]): Section[] {
  const allText = splitIntoPages(text, pages).join("\n");
  const lines = allText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sections: Section[] = [];
  let currentQ: string | null = null;
  let answer: string[] = [];

  const flush = () => {
    if (!currentQ) return;
    const ans = answer.join("\n").trim();
    const body = `Q: ${currentQ}\nA: ${ans || "unknown"}`;
    sections.push({ title: currentQ, text: body });
    currentQ = null;
    answer = [];
  };

  for (const line of lines) {
    const qMatch = line.match(/^\d+[.)]\s+(.+)/);
    const qPrefix = line.match(/^(q|question)\s*[:\-–]\s*(.+)$/i);
    if (qMatch || qPrefix) {
      flush();
      currentQ = (qMatch ? qMatch[1] : qPrefix?.[2] || "").trim();
      continue;
    }
    const aPrefix = line.match(/^(a|answer)\s*[:\-–]\s*(.+)$/i);
    if (aPrefix) {
      if (!currentQ) currentQ = "Question";
      answer.push(aPrefix[2].trim());
      continue;
    }
    if (currentQ) {
      answer.push(line);
    }
  }
  flush();

  return sections;
}

function buildParagraphSections(text: string, pages?: string[]): Section[] {
  const allText = splitIntoPages(text, pages).join("\n");
  const blocks = allText.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const sections: Section[] = [];
  const minChars = Number(process.env.RAG_CONVO_BLOCK_MIN_CHARS || 80);

  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i];
    const next = blocks[i + 1];
    if (block.endsWith("?") && next) {
      block = `${block}\n${next}`;
      i += 1;
    }
    if (block.length < minChars && next) {
      block = `${block}\n${next}`;
      i += 1;
    }
    sections.push({ title: `Block ${sections.length + 1}`, text: block });
  }

  return sections;
}

function makeAbstract(text: string, targetTokens: number): string {
  const maxChars = targetTokens * 4;
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > maxChars) break;
    out = out ? `${out} ${s}` : s;
  }
  if (!out) {
    out = text.slice(0, maxChars);
  }
  return out.trim();
}

function splitTextWithOverlap(text: string, maxTokens: number, overlapTokens: number): string[] {
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;
  if (text.length <= maxChars) return [text];
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf: string[] = [];
  let len = 0;

  for (const line of lines) {
    if (len + line.length + 1 > maxChars && buf.length > 0) {
      chunks.push(buf.join("\n"));
      let overlap: string[] = [];
      let oLen = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        const l = buf[i];
        if (oLen + l.length + 1 > overlapChars) break;
        overlap.unshift(l);
        oLen += l.length + 1;
      }
      buf = overlap;
      len = oLen;
    }
    buf.push(line);
    len += line.length + 1;
  }
  if (buf.length > 0) chunks.push(buf.join("\n"));
  return chunks;
}

function buildFullChunksFromSections(
  sections: Section[],
  opts: { maxTokens: number; overlapTokens: number; questionFromTitle?: boolean },
): SmartChunk[] {
  const chunks: SmartChunk[] = [];
  for (const section of sections) {
    const fullParts = splitTextWithOverlap(section.text, opts.maxTokens, opts.overlapTokens);
    for (const part of fullParts) {
      const fullText = `Title: ${section.title}\n${part}`;
      chunks.push({
        text: fullText,
        chunkType: "section_full",
        headingContext: section.title,
        chunkIndex: chunks.length,
        charStart: 0,
        charEnd: 0,
        tokenEstimate: estimateTokens(fullText),
        products: [],
        keywords: extractKeywordsLite(fullText),
        prices: extractPricesLite(fullText),
        question: opts.questionFromTitle ? section.title : null,
        contextBefore: "",
        contextAfter: "",
      });
    }
  }
  return chunks;
}

function buildInventoryHierarchicalChunks(text: string, pages?: string[]): SmartChunk[] {
  const pageTexts = splitIntoPages(text, pages);
  const sections: Section[] = pageTexts.map((p, i) => ({
    title: `Page ${i + 1}`,
    text: p,
  }));
  return buildFullChunksFromSections(sections, { maxTokens: 500, overlapTokens: 60 });
}

function buildConversationHierarchicalChunks(text: string, pages?: string[]): SmartChunk[] {
  let sections = buildConversationSections(text, pages);
  if (sections.length === 0) {
    sections = buildParagraphSections(text, pages);
  }
  if (sections.length === 0) {
    sections = buildSectionsFromPages(splitIntoPages(text, pages));
  }
  return buildFullChunksFromSections(sections, { maxTokens: 400, overlapTokens: 40, questionFromTitle: true });
}

async function deleteExistingVectorsForDocType(params: {
  index: ReturnType<typeof getPineconeIndex>;
  namespace: string;
  docType: DocType;
}): Promise<void> {
  const { index, namespace, docType } = params;
  const ns: any = index.namespace(namespace);

  // Best-effort strategy:
  // 1) Serverless-safe: list IDs by prefix and delete by ids (does not require metadata filter support).
  // 2) Fallback: delete by metadata filter (works on pod-based indexes; may require metadata indexing on some serverless setups).
  const prefix = `${docType}:`;

  if (typeof ns.list === "function") {
    console.log(`[rag:index] pinecone list+delete namespace=${namespace} prefix=${prefix}`);
    let paginationToken: string | undefined = undefined;
    let totalDeleted = 0;

    for (let page = 0; page < 10_000; page++) {
      const res: any = await ns.list({ prefix, limit: 1000, paginationToken });
      const ids: string[] = (res?.vectors || [])
        .map((v: any) => v?.id)
        .filter((id: any) => typeof id === "string" && id.length > 0);

      if (ids.length > 0) {
        // deleteMany accepts an array of ids
        await ns.deleteMany(ids);
        totalDeleted += ids.length;
      }

      const next: string | undefined = res?.pagination?.next;
      if (!next) break;
      paginationToken = next;
    }

    console.log(`[rag:index] pinecone deleted=${totalDeleted} namespace=${namespace} docType=${docType}`);
    return;
  }

  // Fallback: metadata delete
  console.log(`[rag:index] pinecone deleteMany(filter) namespace=${namespace} docType=${docType}`);
  try {
    await ns.deleteMany({ filter: { docType } });
  } catch (err: any) {
    // 404 is fine on first run (namespace doesn't exist yet)
    if (err?.status === 404 || err?.message?.includes("404")) {
      console.log(`[rag:index] pinecone delete skipped (namespace not found, first run)`);
      return;
    }
    // If filter deletes aren't supported on this index, don't fail the entire job.
    console.log(`[rag:index] pinecone delete by filter failed (continuing): ${err?.message || String(err)}`);
  }
}

export async function indexSingleDocType(params: {
  businessId: string;
  docType: DocType;
  blobPath: string;
  filename: string;
  contentType?: string;
}): Promise<{ chunkCount: number; sha256: string }>
{
  const { businessId, docType, blobPath, filename } = params;
  console.log(`[rag:index] begin businessId=${businessId} docType=${docType} blobPath=${blobPath}`);

  const blob = await downloadBlobToBuffer(blobPath);
  const hash = sha256Hex(blob.buffer);

  console.log(
    `[rag:index] downloaded bytes=${blob.buffer.length} contentType=${blob.contentType ?? "unknown"} sha256=${hash.slice(0, 12)}…`,
  );

  const extracted = await extractTextFromBuffer({
    buffer: blob.buffer,
    filename,
    contentType: params.contentType ?? blob.contentType,
    preserveLineBreaks: docType === "conversations" || docType === "inventory",
  });

  console.log(
    `[rag:index] extracted chars=${extracted.text.length} pages=${extracted.pageCount ?? "?"} pagesArray=${extracted.pages?.length ?? 0}`,
  );

  let text = extracted.text;
  if (docType === "conversations" || docType === "inventory") {
    const rawBlobPath = `${businessId}/${docType}/raw.txt`;
    await uploadTextToBlob({ blobPath: rawBlobPath, text, contentType: "text/plain" });
  }
  
  // Use page-wise chunking for better context preservation
  // Pass pages array if available for page-boundary-aware chunking
  const chunkOpts = {
    targetTokens: 700,
    minTokens: 200,
    maxTokens: 900,
    overlapTokens: 80,
    pages: extracted.pages,
  };

  let smartChunks =
    docType === "conversations"
      ? buildConversationHierarchicalChunks(text, extracted.pages)
      : docType === "inventory"
        ? buildInventoryHierarchicalChunks(text, extracted.pages)
        : smartChunkText(text, chunkOpts);

  // Use LLM for more accurate chunk type classification (skip for structured chunks)
  if (smartChunks.length > 0 && docType !== "conversations" && docType !== "inventory") {
    console.log(`[rag:index] running LLM chunk classification...`);
    smartChunks = await classifyChunksWithLLM(smartChunks);
  }

  console.log(`[rag:index] smart chunked count=${smartChunks.length} avgTokens=${
    smartChunks.length ? Math.round(smartChunks.reduce((s, c) => s + c.tokenEstimate, 0) / smartChunks.length) : 0
  }`);

  const index = getPineconeIndex();

  // Delete only this docType for this business namespace
  await deleteExistingVectorsForDocType({ index, namespace: businessId, docType });

  const batchSize = Number(process.env.RAG_EMBED_BATCH_SIZE || 64);
  let upserted = 0;

  for (let i = 0; i < smartChunks.length; i += batchSize) {
    const batch = smartChunks.slice(i, i + batchSize);
    const batchTexts = batch.map(c => c.text);
    console.log(`[rag:index] embed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(smartChunks.length / batchSize)} size=${batch.length}`);
    const vectors = await embedTexts(batchTexts);

    const records = vectors.map((values, j) => {
      const chunk = batch[j];

      // Pinecone metadata limit is 40KB per vector.
      // Truncate large fields to stay safely under limit (~30KB target).
      const MAX_TEXT_CHARS = 8000;       // ~8KB for main text
      const MAX_CONTEXT_CHARS = 500;     // ~0.5KB each for context
      const MAX_LIST_CHARS = 500;        // ~0.5KB for products/keywords/prices

      const truncate = (s: string | undefined | null, max: number) =>
        s && s.length > max ? s.slice(0, max) + "…" : s || "";

      const truncateList = (arr: string[], max: number) => {
        const joined = arr.join("|");
        return joined.length > max ? joined.slice(0, max) + "…" : joined;
      };

      return {
        id: `${docType}:${hash}:${chunk.chunkIndex}`,
        values,
        metadata: {
          businessId,
          docType,
          chunkType: chunk.chunkType,                        // Chunk classification (pricing, policy, faq, etc.)
          headingContext: truncate(chunk.headingContext, 200),
          source: blobPath,
          filename,
          chunkIndex: chunk.chunkIndex,
          charStart: chunk.charStart,                        // Position tracking
          charEnd: chunk.charEnd,
          tokenEstimate: chunk.tokenEstimate,                // Token count
          text: truncate(chunk.text, MAX_TEXT_CHARS),
          // Enhanced metadata for enterprise retrieval (truncated to fit limit)
          products: truncateList(chunk.products, MAX_LIST_CHARS),
          keywords: truncateList(chunk.keywords, MAX_LIST_CHARS),
          prices: truncateList(chunk.prices, MAX_LIST_CHARS),
          question: truncate(chunk.question, 500),
          contextBefore: truncate(chunk.contextBefore, MAX_CONTEXT_CHARS),
          contextAfter: truncate(chunk.contextAfter, MAX_CONTEXT_CHARS),
        },
      };
    });

    await index.namespace(businessId).upsert(records);
    upserted += records.length;
    console.log(`[rag:index] pinecone upserted=${upserted}/${smartChunks.length}`);
  }

  // Log chunk type distribution for debugging
  const typeCounts: Record<string, number> = {};
  for (const chunk of smartChunks) {
    typeCounts[chunk.chunkType] = (typeCounts[chunk.chunkType] || 0) + 1;
  }
  console.log(`[rag:index] chunk types: ${JSON.stringify(typeCounts)}`);

  console.log(`[rag:index] done businessId=${businessId} docType=${docType} upserted=${upserted}`);
  return { chunkCount: upserted, sha256: hash };
}
