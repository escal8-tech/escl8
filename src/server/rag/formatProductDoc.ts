import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_VALIDATE_MODEL = "gpt-4.1-nano";
const DEFAULT_ALIAS_MODEL = "gpt-4.1-nano";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  client = new OpenAI({ apiKey: key });
  return client;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function splitIntoSections(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  const headingRegex = /^(\s*#{1,6}\s+.+|[A-Z][A-Z\s]{2,}:?|[0-9]+[.)]\s+[A-Z].+)\s*$/;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (headingRegex.test(line) && current.length > 0) {
      sections.push(current.join("\n").trim());
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    sections.push(current.join("\n").trim());
  }

  return sections.filter((s) => s.length > 0);
}

function chunkSection(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    const slice = text.slice(start, end);
    const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
    if (lastBreak > maxChars * 0.6) {
      end = start + lastBreak;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) parts.push(chunk);
    start = end;
  }
  return parts.length > 0 ? parts : [text];
}

async function formatSectionWithLLM(section: string, index: number): Promise<string> {
  const model = process.env.OPENAI_CHAT_MODEL || DEFAULT_MODEL;
  const prompt = `You are formatting a product/inventory document section for RAG retrieval.
Rewrite the content into structured Markdown using the template below.
Do NOT drop any facts. If unsure, include the raw line under "Details".

Template:
## Product: <name or category>
Summary: <1-3 sentences>
Features:
- ...
Options/Variants:
- ...
Pricing:
- ...
Specs:
- ...
Policies/Constraints:
- ...
Details:
- <verbatim or near-verbatim lines that don't fit>

Rules:
- If the section contains multiple products, output multiple "## Product:" blocks.
- If no product name is present, use a descriptive category name.
- Preserve tables as bullet rows under "Details" (do not omit values).
- If pricing varies by conditions (group size, hotel stars, dates, options), list those conditions clearly under Pricing or Options/Variants.

Section ${index}:
${section}`.trim();

  const c = getClient();
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 1200,
  });

  return (res.choices[0]?.message?.content || "").trim();
}

async function reconcileFormattedSection(section: string, formatted: string, index: number): Promise<string> {
  const model = process.env.OPENAI_CHAT_MODEL || DEFAULT_MODEL;
  const prompt = `You are validating and correcting a formatted product section for RAG retrieval.
Compare the ORIGINAL text with the FORMATTED text. Fix any missing facts or wrong facts by inserting them into the correct fields.
If the formatted text is missing details, add them under the right headings. If data is redundant or clearly boilerplate, remove it.
Do NOT drop real facts like pricing, options, features, policies, or specs.
Return only the corrected formatted Markdown.

ORIGINAL (section ${index}):
${section}

FORMATTED (section ${index}):
${formatted}`.trim();

  const c = getClient();
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 1200,
  });

  return (res.choices[0]?.message?.content || "").trim();
}

async function validateFormattedSection(section: string, formatted: string, index: number): Promise<{ ok: boolean; missingFacts: string[]; notes?: string }> {
  const model = process.env.OPENAI_CHAT_MODEL || DEFAULT_MODEL;
  const prompt = `You are a strict validator. Compare ORIGINAL vs FORMATTED and decide if any factual details were lost or changed.
Return JSON ONLY: {"ok": true|false, "missingFacts": ["..."], "notes": "optional"}.
Only include missing facts that matter to product understanding (pricing, options, features, specs, constraints, policies).
If everything important is preserved, ok=true and missingFacts=[].

ORIGINAL (section ${index}):
${section}

FORMATTED (section ${index}):
${formatted}`.trim();

  const c = getClient();
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 400,
  });

  const content = (res.choices[0]?.message?.content || "").trim();
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    return { ok: false, missingFacts: ["Validator returned non-JSON response"], notes: content.slice(0, 200) };
  }
  try {
    const obj = JSON.parse(match[0]);
    return {
      ok: Boolean(obj.ok),
      missingFacts: Array.isArray(obj.missingFacts) ? obj.missingFacts.map(String) : [],
      notes: typeof obj.notes === "string" ? obj.notes : undefined,
    };
  } catch {
    return { ok: false, missingFacts: ["Validator returned invalid JSON"], notes: content.slice(0, 200) };
  }
}

export type ProductFormatReport = {
  sectionIndex: number;
  chunkIndex: number;
  ok: boolean;
  missingFacts: string[];
  notes?: string;
};

type ProductCoverageReport = {
  ok: boolean;
  missingProducts: string[];
  missingVariants: string[];
  notes?: string;
};

export type ProductAliasMap = Record<string, string[]>;

async function validateProductCoverage(original: string, formatted: string): Promise<ProductCoverageReport> {
  const model = process.env.RAG_PRODUCT_VALIDATE_MODEL || DEFAULT_VALIDATE_MODEL;
  const prompt = `You are validating product coverage between ORIGINAL and FORMATTED documents.
Return JSON ONLY:
{
  "ok": true|false,
  "missingProducts": ["..."],
  "missingVariants": ["..."],
  "notes": "optional"
}

Guidelines:
- "missingProducts" should include any product/tour/service in ORIGINAL that is absent in FORMATTED.
- "missingVariants" should include missing variants/options/pricing tiers (e.g., 2-star vs 4-star, group size tiers).
- If everything is covered, ok=true and both arrays empty.

ORIGINAL:
${original}

FORMATTED:
${formatted}`.trim();

  const c = getClient();
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 600,
  });

  const content = (res.choices[0]?.message?.content || "").trim();
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      ok: false,
      missingProducts: ["Validator returned non-JSON response"],
      missingVariants: [],
      notes: content.slice(0, 200),
    };
  }
  try {
    const obj = JSON.parse(match[0]);
    return {
      ok: Boolean(obj.ok),
      missingProducts: Array.isArray(obj.missingProducts) ? obj.missingProducts.map(String) : [],
      missingVariants: Array.isArray(obj.missingVariants) ? obj.missingVariants.map(String) : [],
      notes: typeof obj.notes === "string" ? obj.notes : undefined,
    };
  } catch {
    return {
      ok: false,
      missingProducts: ["Validator returned invalid JSON"],
      missingVariants: [],
      notes: content.slice(0, 200),
    };
  }
}

export async function extractProductAliasesWithLLM(formatted: string): Promise<ProductAliasMap> {
  const model = process.env.RAG_PRODUCT_ALIAS_MODEL || DEFAULT_ALIAS_MODEL;
  const prompt = `Extract product aliases from the FORMATTED document.
Return JSON ONLY as an object mapping product name to aliases:
{
  "Product Name": ["alias1", "alias2", ...],
  "Another Product": ["aliasA", "aliasB"]
}

Rules:
- Aliases should be short, common variations (abbreviations, informal names, simplified names).
- Do NOT invent products that are not present.
- If a product has no reasonable aliases, return an empty array.

FORMATTED:
${formatted}`.trim();

  const c = getClient();
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 600,
  });

  const content = (res.choices[0]?.message?.content || "").trim();
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const obj = JSON.parse(match[0]);
    const out: ProductAliasMap = {};
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof k !== "string") continue;
        const arr = Array.isArray(v) ? v.map(String) : [];
        out[k] = Array.from(new Set(arr.filter(a => a && a.toLowerCase() !== k.toLowerCase()))).slice(0, 10);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function injectAliasesIntoFormatted(formatted: string, aliases: ProductAliasMap): string {
  if (!formatted || !Object.keys(aliases).length) return formatted;
  const lines = formatted.split(/\r?\n/);
  const out: string[] = [];
  let currentProduct: string | null = null;
  let aliasInserted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^##\s*Product:\s*(.+)$/i);
    if (headerMatch) {
      currentProduct = headerMatch[1].trim();
      aliasInserted = false;
      out.push(line);
      const list = aliases[currentProduct] || [];
      if (list.length) {
        out.push(`Aliases: ${list.join(", ")}`);
        aliasInserted = true;
      }
      continue;
    }

    if (currentProduct && !aliasInserted && line.trim().startsWith("Summary:")) {
      const list = aliases[currentProduct] || [];
      if (list.length) {
        out.push(`Aliases: ${list.join(", ")}`);
        aliasInserted = true;
      }
    }

    out.push(line);
  }

  return out.join("\n");
}

async function repairFormattedCoverage(params: { original: string; formatted: string; missingProducts: string[]; missingVariants: string[] }): Promise<string> {
  const model = process.env.RAG_PRODUCT_REPAIR_MODEL || DEFAULT_MODEL;
  const prompt = `You are repairing a formatted product document to include missing items.
Given ORIGINAL and FORMATTED, insert the missing products/variants into the correct product blocks.
Do NOT remove existing data. Keep formatting consistent with the template.
Return ONLY the corrected formatted Markdown.

Missing products:
${params.missingProducts.join("; ") || "none"}

Missing variants/pricing tiers:
${params.missingVariants.join("; ") || "none"}

ORIGINAL:
${params.original}

FORMATTED:
${params.formatted}`.trim();

  const c = getClient();
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 1400,
  });

  return (res.choices[0]?.message?.content || "").trim();
}

function extractCandidateProducts(text: string): string[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const candidates: string[] = [];
  for (const line of lines) {
    if (/^\d+\.\s+/.test(line) || /^[-•]\s+/.test(line)) {
      const name = line.replace(/^\d+\.\s+/, "").replace(/^[-•]\s+/, "").split("–")[0].split("-")[0].trim();
      if (name.length >= 3 && name.length <= 120) candidates.push(name);
    }
    if (/[A-Z][a-z].+\s+\((?:RM|MYR|USD|US\$|\$|£|€|₹)/.test(line)) {
      const name = line.split("(")[0].trim();
      if (name.length >= 3 && name.length <= 120) candidates.push(name);
    }
  }
  return Array.from(new Set(candidates)).slice(0, 200);
}

async function refineProductListWithLLM(text: string, candidates: string[]): Promise<string[]> {
  const model = process.env.RAG_PRODUCT_LIST_MODEL || DEFAULT_MODEL;
  const prompt = `You are extracting a clean list of product/tour names from a raw document.
Return JSON array of product names only.

Candidates (may include noise):
${candidates.join("; ")}

RAW:
${text}`.trim();
  const c = getClient();
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 500,
  });
  const content = (res.choices[0]?.message?.content || "").trim();
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return candidates;
  try {
    const arr = JSON.parse(match[0]) as string[];
    return Array.from(new Set(arr.map(String).map(s => s.trim()).filter(Boolean)));
  } catch {
    return candidates;
  }
}

async function extractProductBlock(params: { product: string; raw: string }): Promise<string> {
  const model = process.env.RAG_PRODUCT_EXTRACT_MODEL || DEFAULT_MODEL;
  const prompt = `Extract ONLY verbatim lines for the product "${params.product}".
Return JSON ONLY in this shape:
{
  "summary": ["line", ...],
  "features": ["line", ...],
  "options": ["line", ...],
  "pricing": ["line", ...],
  "specs": ["line", ...],
  "policies": ["line", ...],
  "details": ["line", ...]
}

Rules:
- Every line must be copied verbatim from RAW.
- If unsure, put the line under "details".
- Do not invent or rewrite.
- Do not include other products.

RAW:
${params.raw}`.trim();
  const c = getClient();
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 900,
  });
  return (res.choices[0]?.message?.content || "").trim();
}

async function validateProductBlock(params: { product: string; raw: string; block: string }): Promise<ProductCoverageReport> {
  const model = process.env.RAG_PRODUCT_VALIDATE_MODEL || DEFAULT_VALIDATE_MODEL;
  const prompt = `Validate that the FORMATTED block contains all key facts for the product "${params.product}".
Return JSON ONLY:
{"ok": true|false, "missingProducts": [], "missingVariants": ["..."], "notes": "optional"}
MissingVariants should list missing pricing tiers/options/features that matter.

RAW:
${params.raw}

FORMATTED:
${params.block}`.trim();
  const c = getClient();
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 400,
  });
  const content = (res.choices[0]?.message?.content || "").trim();
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, missingProducts: [], missingVariants: ["validator_non_json"] };
  try {
    const obj = JSON.parse(match[0]);
    return {
      ok: Boolean(obj.ok),
      missingProducts: [],
      missingVariants: Array.isArray(obj.missingVariants) ? obj.missingVariants.map(String) : [],
      notes: typeof obj.notes === "string" ? obj.notes : undefined,
    };
  } catch {
    return { ok: false, missingProducts: [], missingVariants: ["validator_invalid_json"] };
  }
}

function fallbackAppendRaw(block: string, raw: string, product: string): string {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const matched = lines.filter(l => l.toLowerCase().includes(product.toLowerCase())).slice(0, 30);
  if (matched.length === 0) return block;
  return `${block}\n\nDetails:\n- ${matched.join("\n- ")}`;
}

export async function formatProductDocWithLLM(text: string): Promise<{ formatted: string; report: ProductFormatReport[]; coverage: ProductCoverageReport }> {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return { formatted: normalized, report: [], coverage: { ok: true, missingProducts: [], missingVariants: [] } };

  const rawLines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rawSet = new Set(rawLines.map(l => l.toLowerCase()));

  const candidates = extractCandidateProducts(normalized);
  const refined = await refineProductListWithLLM(normalized, candidates);
  const products = refined.filter(p => rawSet.has(p.toLowerCase()) || normalized.toLowerCase().includes(p.toLowerCase()));

  const report: ProductFormatReport[] = [];
  const blocks: string[] = [];
  let idx = 0;

  for (const product of products) {
    idx += 1;
    const productLower = product.toLowerCase();
    const contextLines: string[] = [];
    const maxContext = Number(process.env.RAG_PRODUCT_CONTEXT_LINES || 2);

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.toLowerCase().includes(productLower)) {
        contextLines.push(line);
        for (let j = 1; j <= maxContext; j++) {
          const next = rawLines[i + j];
          if (!next) break;
          if (/^(\d+\.|[-•])\s+[A-Z]/.test(next)) break;
          contextLines.push(next);
        }
      }
    }

    const uniqueContext = Array.from(new Set(contextLines));
    const rawContext = uniqueContext.join("\n");

    let extracted = await extractProductBlock({ product, raw: rawContext || normalized });
    let parsed: Record<string, string[]> = {};
    const match = extracted.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = {};
      }
    }

    const pick = (key: string) =>
      (parsed[key] || []).map(String).map(s => s.trim()).filter(s => rawSet.has(s.toLowerCase()));

    const summary = pick("summary");
    const features = pick("features");
    const options = pick("options");
    const pricing = pick("pricing");
    const specs = pick("specs");
    const policies = pick("policies");
    const details = pick("details");

    const used = new Set([...summary, ...features, ...options, ...pricing, ...specs, ...policies, ...details].map(l => l.toLowerCase()));
    const missing = uniqueContext.filter(l => !used.has(l.toLowerCase()));

    const linesOrUnknown = (arr: string[]) => (arr.length ? arr : ["unknown"]);
    const blockLines = [
      `## Product: ${product}`,
      `Summary:`,
      ...linesOrUnknown(summary).map(l => `- ${l}`),
      `Features:`,
      ...linesOrUnknown(features).map(l => `- ${l}`),
      `Options/Variants:`,
      ...linesOrUnknown(options).map(l => `- ${l}`),
      `Pricing:`,
      ...linesOrUnknown(pricing).map(l => `- ${l}`),
      `Specs:`,
      ...linesOrUnknown(specs).map(l => `- ${l}`),
      `Policies/Constraints:`,
      ...linesOrUnknown(policies).map(l => `- ${l}`),
      `Details:`,
      ...linesOrUnknown([...details, ...missing]).map(l => `- ${l}`),
    ];

    report.push({
      sectionIndex: idx,
      chunkIndex: 1,
      ok: missing.length === 0,
      missingFacts: missing,
      notes: missing.length ? "Unassigned lines appended to Details." : undefined,
    });

    blocks.push(blockLines.join("\n"));
  }

  const formatted = blocks.join("\n\n");
  const coverage = await validateProductCoverage(normalized, formatted);
  return { formatted, report, coverage };
}
