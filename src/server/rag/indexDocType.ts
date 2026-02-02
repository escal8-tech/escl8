import crypto from "crypto";
import { downloadBlobToBuffer, uploadTextToBlob } from "./blob";
import { extractTextFromBuffer } from "./extractText";
import { smartChunkText, classifyChunksWithLLM, SmartChunk } from "./smartChunk";
import { embedTexts } from "./embed";
import { getPineconeIndex } from "./pinecone";
import { formatConversationForChunking } from "./formatDoc";
import { formatProductDocWithLLM, extractProductAliasesWithLLM, injectAliasesIntoFormatted, ProductAliasMap } from "./formatProductDoc";

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

function buildConversationChunks(formattedText: string): SmartChunk[] {
  const blocks = formattedText.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const chunks: SmartChunk[] = [];
  let charOffset = 0;

  for (const block of blocks) {
    const questionMatch = block.match(/Q:\s*([^\n]+)/i);
    const answerMatch = block.match(/A:\s*([\s\S]+)/i);
    const question = questionMatch?.[1]?.trim() || null;
    const answer = answerMatch?.[1]?.trim() || "";
    const text = block;

    const start = charOffset;
    const end = charOffset + block.length;
    charOffset = end + 2;

    chunks.push({
      text,
      chunkType: "faq",
      headingContext: null,
      chunkIndex: chunks.length,
      charStart: start,
      charEnd: end,
      tokenEstimate: estimateTokens(text),
      products: [],
      keywords: [],
      prices: [],
      question,
      contextBefore: "",
      contextAfter: "",
    });
  }

  return chunks;
}

type ProductSection = {
  name: string;
  content: string;
};

function splitProductBlocks(formattedText: string): string[] {
  const lines = formattedText.split(/\r?\n/);
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("## Product:")) {
      if (current.length > 0) {
        blocks.push(current.join("\n").trim());
        current = [];
      }
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n").trim());
  return blocks.filter(b => b.length > 0);
}

function parseProductSections(block: string): { productName: string; sections: ProductSection[] } {
  const lines = block.split(/\r?\n/);
  const header = lines.find(l => l.trim().startsWith("## Product:")) || "## Product: Unknown";
  const productName = header.replace(/^##\s*Product:\s*/i, "").trim() || "Unknown";

  const sections: ProductSection[] = [];
  const sectionNames = [
    "Summary",
    "Features",
    "Options/Variants",
    "Pricing",
    "Specs",
    "Policies/Constraints",
    "Details",
  ];
  const sectionRegex = new RegExp(`^(${sectionNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}):\\s*$`, "i");

  let currentName = "Summary";
  let currentLines: string[] = [];

  for (const line of lines.slice(1)) {
    const match = line.match(sectionRegex);
    if (match) {
      if (currentLines.length > 0) {
        sections.push({ name: currentName, content: currentLines.join("\n").trim() });
      }
      currentName = match[1];
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    sections.push({ name: currentName, content: currentLines.join("\n").trim() });
  }

  return { productName, sections: sections.filter(s => s.content.length > 0) };
}

function splitSectionByParagraphs(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];
  const parts = content.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf: string[] = [];
  let len = 0;
  const overlapParas = Number(process.env.RAG_INVENTORY_SECTION_OVERLAP_PARAS || 1);

  for (const part of parts) {
    if (len + part.length + 2 > maxChars && buf.length > 0) {
      chunks.push(buf.join("\n\n"));
      const overlap = overlapParas > 0 ? buf.slice(-overlapParas) : [];
      buf = overlap;
      len = overlap.reduce((s, p) => s + p.length + 2, 0);
    }
    buf.push(part);
    len += part.length + 2;
  }
  if (buf.length > 0) chunks.push(buf.join("\n\n"));
  return chunks.length > 0 ? chunks : [content];
}

function buildInventoryChunks(formattedText: string, aliases: ProductAliasMap = {}): SmartChunk[] {
  const blocks = splitProductBlocks(formattedText);
  const chunks: SmartChunk[] = [];
  const maxChars = Number(process.env.RAG_INVENTORY_SECTION_MAX_CHARS || 6000);
  const productNames: string[] = [];

  for (const block of blocks) {
    const { productName, sections } = parseProductSections(block);
    productNames.push(productName);
    const aliasList = aliases[productName] || [];
    for (const section of sections) {
      const contentChunks = splitSectionByParagraphs(section.content, maxChars);
      for (const c of contentChunks) {
        const text = `Product: ${productName}\nSection: ${section.name}\n${c}`;
        let chunkType: SmartChunk["chunkType"] = "product_info";
        const name = section.name.toLowerCase();
        if (name.includes("pricing")) chunkType = "pricing";
        else if (name.includes("policy")) chunkType = "policy";
        else if (name.includes("details")) chunkType = "general";

        const keywords = Array.from(new Set([...extractKeywordsLite(text), ...aliasList]));
        const prices = extractPricesLite(text);

        chunks.push({
          text,
          chunkType,
          headingContext: productName,
          chunkIndex: chunks.length,
          charStart: 0,
          charEnd: 0,
          tokenEstimate: estimateTokens(text),
          products: [productName],
          keywords,
          prices,
          question: null,
          contextBefore: "",
          contextAfter: "",
        });
      }
    }
  }

  if (productNames.length > 0) {
    const uniqueNames = Array.from(new Set(productNames));
    const indexLines = uniqueNames.map((n, i) => {
      const a = aliases[n] || [];
      return `${i + 1}. ${n}${a.length ? ` (aliases: ${a.join(", ")})` : ""}`;
    });
    const indexText = `Product Index:\n${indexLines.join("\n")}`;
    chunks.unshift({
      text: indexText,
      chunkType: "product_index",
      headingContext: "Product Index",
      chunkIndex: 0,
      charStart: 0,
      charEnd: 0,
      tokenEstimate: estimateTokens(indexText),
      products: uniqueNames,
      keywords: extractKeywordsLite(indexText),
      prices: [],
      question: null,
      contextBefore: "",
      contextAfter: "",
    });

    for (let i = 0; i < chunks.length; i++) {
      chunks[i].chunkIndex = i;
    }
  }

  return chunks;
}

function extractProductNamesFromFormatted(formattedText: string): string[] {
  const blocks = splitProductBlocks(formattedText);
  const names = blocks.map(b => parseProductSections(b).productName).filter(Boolean);
  return Array.from(new Set(names));
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
  });

  console.log(
    `[rag:index] extracted chars=${extracted.text.length} pages=${extracted.pageCount ?? "?"} pagesArray=${extracted.pages?.length ?? 0}`,
  );

  let text = extracted.text;
  let formattedText: string | null = null;
  let aliases: ProductAliasMap = {};

  if (docType === "conversations") {
    const rawBlobPath = `${businessId}/${docType}/raw.txt`;
    await uploadTextToBlob({ blobPath: rawBlobPath, text, contentType: "text/plain" });

    formattedText = formatConversationForChunking(text);
    if (!formattedText || formattedText.length === 0) {
      throw new Error("Conversation document formatting failed (empty result). Please try again later.");
    }
    text = formattedText;
    const formattedBlobPath = `${businessId}/${docType}/formatted.txt`;
    await uploadTextToBlob({ blobPath: formattedBlobPath, text: formattedText, contentType: "text/plain" });

    const reportBlobPath = `${businessId}/${docType}/format_report.json`;
    await uploadTextToBlob({
      blobPath: reportBlobPath,
      text: JSON.stringify({ generatedAt: new Date().toISOString(), formatter: "rule-based" }, null, 2),
      contentType: "application/json",
    });
  }

  if (docType === "inventory") {
    const rawBlobPath = `${businessId}/${docType}/raw.txt`;
    await uploadTextToBlob({ blobPath: rawBlobPath, text, contentType: "text/plain" });

    const res = await formatProductDocWithLLM(text);
    if (!res.formatted || res.formatted.length === 0) {
      throw new Error("Product document formatting failed (empty result). Please try again later.");
    }
    formattedText = res.formatted;
    text = res.formatted;
    const formattedBlobPath = `${businessId}/${docType}/formatted.txt`;
    await uploadTextToBlob({ blobPath: formattedBlobPath, text: res.formatted, contentType: "text/plain" });

    const reportBlobPath = `${businessId}/${docType}/format_report.json`;
    await uploadTextToBlob({
      blobPath: reportBlobPath,
      text: JSON.stringify({ generatedAt: new Date().toISOString(), report: res.report, coverage: res.coverage }, null, 2),
      contentType: "application/json",
    });

    try {
      aliases = await extractProductAliasesWithLLM(res.formatted);
    } catch (err: any) {
      console.error(`[rag:index] product alias extraction failed: ${err?.message || String(err)}`);
    }

    const formattedWithInlineAliases = Object.keys(aliases).length ? injectAliasesIntoFormatted(res.formatted, aliases) : res.formatted;
    text = formattedWithInlineAliases;
    const productNames = extractProductNamesFromFormatted(formattedWithInlineAliases);
    if (Object.keys(aliases).length) {
      const formattedAliasBlobPath = `${businessId}/${docType}/formatted_with_aliases.txt`;
      await uploadTextToBlob({
        blobPath: formattedAliasBlobPath,
        text: formattedWithInlineAliases,
        contentType: "text/plain",
      });
    }
    const missingFactCount = res.report.reduce((sum, r) => sum + (r.missingFacts?.length || 0), 0);
    const audit = {
      generatedAt: new Date().toISOString(),
      productCount: productNames.length,
      products: productNames,
      aliases,
      coverage: res.coverage,
      missingFactCount,
      sectionChecks: res.report.map(r => ({
        sectionIndex: r.sectionIndex,
        chunkIndex: r.chunkIndex,
        ok: r.ok,
        missingFacts: r.missingFacts,
        notes: r.notes,
      })),
    };
    const auditBase = `${businessId}/${docType}/audit`;
    await uploadTextToBlob({
      blobPath: `${auditBase}/summary.json`,
      text: JSON.stringify(audit, null, 2),
      contentType: "application/json",
    });
    await uploadTextToBlob({
      blobPath: `${auditBase}/summary.txt`,
      text: [
        `Product Audit Summary`,
        `Generated: ${audit.generatedAt}`,
        `Products (${productNames.length}): ${productNames.join(", ") || "none"}`,
        `Aliases: ${Object.keys(aliases).length ? Object.entries(aliases).map(([k, v]) => `${k} -> ${v.join(", ")}`).join(" | ") : "none"}`,
        `Coverage OK: ${res.coverage.ok}`,
        `Missing Products: ${res.coverage.missingProducts.join("; ") || "none"}`,
        `Missing Variants: ${res.coverage.missingVariants.join("; ") || "none"}`,
        `Missing Facts (total): ${missingFactCount}`,
      ].join("\n"),
      contentType: "text/plain",
    });
  }
  
  // Use page-wise chunking for better context preservation
  // Pass pages array if available for page-boundary-aware chunking
  const chunkOpts =
    docType === "conversations"
      ? {
          targetTokens: 300,
          minTokens: 80,
          maxTokens: 600,
          overlapTokens: 30,
          pages: undefined,
        }
      : docType === "inventory"
        ? {
            targetTokens: 500,
            minTokens: 120,
            maxTokens: 900,
            overlapTokens: 40,
            pages: undefined,
          }
        : {
            targetTokens: 800,
            minTokens: 200,
            maxTokens: 1500,
            overlapTokens: 50,
            pages: extracted.pages,
          };

  let smartChunks =
    docType === "conversations"
      ? buildConversationChunks(text)
      : docType === "inventory"
        ? buildInventoryChunks(text, typeof aliases === "object" ? aliases : {})
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
