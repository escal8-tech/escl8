/**
 * Enterprise-grade smart chunker for RAG.
 * 
 * Features:
 * - Structure-aware chunking (headers, lists, tables, Q&A pairs)
 * - Semantic boundary detection
 * - Optimal chunk sizes (150-350 tokens, ~600-1400 chars)
 * - Chunk type classification for metadata filtering
 * - Preserves context with smart overlap
 * - Entity extraction (products, prices, keywords)
 * - FAQ question extraction for HyDE matching
 */

import OpenAI from "openai";

export type ChunkType = 
  | "pricing"
  | "policy"
  | "faq"
  | "example_dialogue"
  | "contact_info"
  | "product_info"
  | "product_index"
  | "section_abstract"
  | "section_full"
  | "general";

export interface SmartChunk {
  text: string;
  chunkType: ChunkType;
  headingContext: string | null;  // Parent heading for context
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  tokenEstimate: number;
  
  // NEW: Enhanced metadata for enterprise retrieval
  products: string[];          // Products/services mentioned
  keywords: string[];          // Pre-extracted searchable terms
  prices: string[];            // Extracted price values (e.g., "RM150", "$99")
  question: string | null;     // For FAQ chunks, the question being answered
  contextBefore: string;       // Brief context of preceding content
  contextAfter: string;        // Brief context of following content
}

// Rough token estimation (1 token ≈ 4 chars for English)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract price values from text (e.g., "RM150", "$99.99", "£50")
 */
function extractPrices(text: string): string[] {
  const pricePatterns = [
    /(?:RM|MYR)\s*[\d,]+(?:\.\d{2})?/gi,        // Malaysian Ringgit
    /\$\s*[\d,]+(?:\.\d{2})?/g,                  // Dollar sign
    /(?:USD|US\$)\s*[\d,]+(?:\.\d{2})?/gi,      // US Dollar
    /£\s*[\d,]+(?:\.\d{2})?/g,                   // British Pound
    /€\s*[\d,]+(?:\.\d{2})?/g,                   // Euro
    /₹\s*[\d,]+(?:\.\d{2})?/g,                   // Indian Rupee
    /(?:SGD|S\$)\s*[\d,]+(?:\.\d{2})?/gi,       // Singapore Dollar
    /[\d,]+(?:\.\d{2})?\s*(?:ringgit|dollars?|pounds?|euros?)/gi, // Written currencies
  ];
  
  const prices: Set<string> = new Set();
  for (const pattern of pricePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(m => prices.add(m.trim()));
    }
  }
  return [...prices].slice(0, 20); // Cap at 20 prices per chunk
}

/**
 * Extract product/service names from text
 */
function extractProducts(text: string, headingContext: string | null): string[] {
  const products: Set<string> = new Set();
  
  // Look for items in lists (often products/services)
  const listMatches = text.match(/^[-•*]\s+([A-Z][^:\n]{2,50})$/gm);
  if (listMatches) {
    listMatches.forEach(m => {
      const item = m.replace(/^[-•*]\s+/, '').trim();
      if (item.length >= 3 && item.length <= 50) {
        products.add(item);
      }
    });
  }
  
  // Look for quoted product names
  const quotedMatches = text.match(/["']([A-Za-z][^"']{2,40})["']/g);
  if (quotedMatches) {
    quotedMatches.forEach(m => {
      const item = m.slice(1, -1).trim();
      if (item.length >= 3) products.add(item);
    });
  }
  
  // Look for capitalized phrases (potential product names)
  const capMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g);
  if (capMatches) {
    capMatches.forEach(m => {
      // Filter out common non-product phrases
      if (!/^(The |This |That |Our |Your |Please |Thank |Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(m)) {
        products.add(m);
      }
    });
  }
  
  // Include heading context as potential product category
  if (headingContext && headingContext.length <= 50) {
    products.add(headingContext);
  }
  
  return [...products].slice(0, 15); // Cap at 15 products per chunk
}

/**
 * Extract searchable keywords from text
 */
function extractKeywords(text: string): string[] {
  const keywords: Set<string> = new Set();
  
  // Extract significant words (longer words, likely important)
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const wordFreq: Record<string, number> = {};
  
  // Common stop words to exclude
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'been', 'were', 'will', 'would',
    'could', 'should', 'their', 'there', 'which', 'about', 'into', 'more',
    'other', 'some', 'such', 'than', 'then', 'these', 'they', 'through',
    'very', 'your', 'also', 'each', 'just', 'like', 'make', 'when', 'only'
  ]);
  
  words.forEach(word => {
    if (!stopWords.has(word)) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  });
  
  // Get top keywords by frequency
  const sortedWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);
  
  sortedWords.forEach(w => keywords.add(w));
  
  // Add any technical terms or specific patterns
  const technicalMatches = text.match(/\b[A-Z]{2,}(?:-\d+)?\b/g); // Acronyms, model numbers
  if (technicalMatches) {
    technicalMatches.forEach(m => keywords.add(m.toLowerCase()));
  }
  
  return [...keywords].slice(0, 25); // Cap at 25 keywords
}

/**
 * Extract the question from FAQ-style content
 */
function extractQuestion(text: string, chunkType: ChunkType): string | null {
  if (chunkType !== 'faq') return null;
  
  // Try various Q&A patterns
  const patterns = [
    /^Q:\s*(.+?)(?:\n|$)/im,
    /^Question:\s*(.+?)(?:\n|$)/im,
    /^\?\s*(.+?)(?:\n|$)/m,
    /^(.+\?)\s*(?:\n|A:|Answer:)/im,
    /^[-•]\s*(.+\?)$/m,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const question = match[1].trim();
      if (question.length >= 10 && question.length <= 200) {
        return question;
      }
    }
  }
  
  return null;
}

/**
 * Get brief context from adjacent segments
 */
function getContextSummary(text: string | undefined, maxLength: number = 100): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return clean.slice(0, maxLength - 3) + "...";
}

// Detect structural boundaries in text
const HEADING_PATTERNS = [
  /^#{1,6}\s+.+$/gm,                           // Markdown headings
  /^[A-Z][A-Z\s]{2,}:?\s*$/gm,                 // ALL CAPS HEADINGS
  /^[\d]+[.)]\s+[A-Z].+$/gm,                   // Numbered sections like "1. Pricing"
  /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*:?\s*$/gm,   // Title Case Headings
  /^\*\*[^*]+\*\*\s*$/gm,                      // **Bold headings**
];

const LIST_ITEM_PATTERNS = [
  /^[-•*]\s+.+$/gm,                            // Bullet lists
  /^\d+[.)]\s+.+$/gm,                          // Numbered lists
  /^[a-z][.)]\s+.+$/gm,                        // Lettered lists
];

const TABLE_ROW_PATTERNS = [
  /^[|┃].+[|┃]\s*$/gm,                         // Markdown/ASCII tables
  /^.+\t.+$/gm,                                // Tab-separated (TSV)
  /^[^,\n]+(?:,[^,\n]+){2,}$/gm,               // CSV-like rows (3+ columns)
];

const QA_PATTERNS = [
  /^Q:\s*.+$/gim,                              // Q: format
  /^Question:\s*.+$/gim,                       // Question: format
  /^\?\s*.+$/gm,                               // ? prefix
  /^A:\s*.+$/gim,                              // A: format
  /^Answer:\s*.+$/gim,                         // Answer: format
];

const PRICING_KEYWORDS = [
  'price', 'pricing', 'cost', 'fee', 'rate', 'rm', 'usd', 'dollar', 'ringgit',
  'per unit', 'per piece', 'each', 'total', 'discount', 'offer', 'promo',
  'charge', 'payment', 'pay', 'amount', 'sum', 'quote', '₹', '$', '£', '€'
];

const POLICY_KEYWORDS = [
  'policy', 'terms', 'conditions', 'rules', 'guidelines', 'requirements',
  'must', 'shall', 'prohibited', 'allowed', 'permitted', 'refund', 'return',
  'warranty', 'guarantee', 'liability', 'disclaimer', 'privacy', 'security'
];

const CONTACT_KEYWORDS = [
  'address', 'location', 'phone', 'email', 'contact', 'whatsapp', 'call',
  'visit', 'hours', 'open', 'close', 'map', 'direction', 'reach', 'find us'
];

const FAQ_KEYWORDS = [
  'faq', 'frequently asked', 'common question', 'q:', 'a:', 'question:', 'answer:'
];

interface StructuralSegment {
  text: string;
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'qa' | 'other';
  headingContext: string | null;
  startIdx: number;
  endIdx: number;
}

/**
 * Detect the type of content based on keywords and patterns
 */
function classifyChunkType(text: string, headingContext: string | null): ChunkType {
  const combined = `${headingContext || ''} ${text}`.toLowerCase();
  
  // Check for pricing content
  const pricingScore = PRICING_KEYWORDS.filter(kw => combined.includes(kw)).length;
  if (pricingScore >= 2 || /(?:rm|usd|\$|₹|£|€)\s*\d+/i.test(combined)) {
    return 'pricing';
  }
  
  // Check for FAQ/Q&A
  if (FAQ_KEYWORDS.some(kw => combined.includes(kw)) || QA_PATTERNS.some(p => p.test(text))) {
    return 'faq';
  }
  
  // Check for dialogue examples
  if (/(?:customer|user|client|agent|bot|assistant):/i.test(text) ||
      /^[-–—]\s*["'].+["']/m.test(text)) {
    return 'example_dialogue';
  }
  
  // Check for contact info
  if (CONTACT_KEYWORDS.filter(kw => combined.includes(kw)).length >= 2) {
    return 'contact_info';
  }
  
  // Check for policies
  if (POLICY_KEYWORDS.filter(kw => combined.includes(kw)).length >= 2) {
    return 'policy';
  }
  
  // Check for product information
  if (/(?:product|item|stock|inventory|available|in stock|model|variant)/i.test(combined)) {
    return 'product_info';
  }
  
  return 'general';
}

/**
 * Split text into structural segments (headings, paragraphs, lists, tables)
 */
function segmentByStructure(text: string): StructuralSegment[] {
  const segments: StructuralSegment[] = [];
  const lines = text.split('\n');
  
  let currentHeading: string | null = null;
  let currentSegment: { lines: string[]; type: StructuralSegment['type']; startLine: number } = {
    lines: [],
    type: 'paragraph',
    startLine: 0
  };
  
  let charOffset = 0;
  const lineOffsets: number[] = [];
  
  for (const line of lines) {
    lineOffsets.push(charOffset);
    charOffset += line.length + 1; // +1 for newline
  }
  
  const flushSegment = (endLine: number) => {
    if (currentSegment.lines.length > 0) {
      const segText = currentSegment.lines.join('\n').trim();
      if (segText) {
        segments.push({
          text: segText,
          type: currentSegment.type,
          headingContext: currentHeading,
          startIdx: lineOffsets[currentSegment.startLine] || 0,
          endIdx: lineOffsets[endLine] || text.length
        });
      }
    }
    currentSegment = { lines: [], type: 'paragraph', startLine: endLine };
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines - they're natural boundaries
    if (!trimmed) {
      if (currentSegment.lines.length > 0) {
        flushSegment(i);
      }
      currentSegment.startLine = i + 1;
      continue;
    }
    
    // Check for headings
    const isHeading = HEADING_PATTERNS.some(p => {
      p.lastIndex = 0;
      return p.test(trimmed);
    });
    
    if (isHeading) {
      flushSegment(i);
      currentHeading = trimmed.replace(/^#+\s*/, '').replace(/[:\*#]+$/, '').trim();
      segments.push({
        text: trimmed,
        type: 'heading',
        headingContext: currentHeading,
        startIdx: lineOffsets[i],
        endIdx: lineOffsets[i + 1] || text.length
      });
      currentSegment.startLine = i + 1;
      continue;
    }
    
    // Check for list items
    const isList = LIST_ITEM_PATTERNS.some(p => {
      p.lastIndex = 0;
      return p.test(trimmed);
    });
    
    // Check for table rows
    const isTable = TABLE_ROW_PATTERNS.some(p => {
      p.lastIndex = 0;
      return p.test(trimmed);
    });
    
    // Check for Q&A
    const isQA = QA_PATTERNS.some(p => {
      p.lastIndex = 0;
      return p.test(trimmed);
    });
    
    // Determine segment type
    let lineType: StructuralSegment['type'] = 'paragraph';
    if (isList) lineType = 'list';
    else if (isTable) lineType = 'table';
    else if (isQA) lineType = 'qa';
    
    // If type changes, flush and start new segment
    if (currentSegment.lines.length > 0 && currentSegment.type !== lineType) {
      flushSegment(i);
    }
    
    currentSegment.type = lineType;
    currentSegment.lines.push(line);
  }
  
  // Flush remaining
  flushSegment(lines.length);
  
  return segments;
}

/**
 * Smart split for long segments that exceed target size.
 * Uses multiple strategies: sentences, newlines, then hard character splits.
 */
function splitLongSegment(
  segment: StructuralSegment,
  targetChars: number,
  overlapChars: number
): StructuralSegment[] {
  const text = segment.text;
  
  // If already small enough, return as-is
  if (text.length <= targetChars * 1.2) {
    return [segment];
  }
  
  const results: StructuralSegment[] = [];
  
  // For lists and tables, split by items/rows
  if (segment.type === 'list' || segment.type === 'table') {
    const lines = text.split('\n');
    let currentBatch: string[] = [];
    let currentLen = 0;
    
    for (const line of lines) {
      if (currentLen + line.length > targetChars && currentBatch.length > 0) {
        results.push({
          ...segment,
          text: currentBatch.join('\n')
        });
        // Keep last item for overlap context
        currentBatch = currentBatch.length > 0 ? [currentBatch[currentBatch.length - 1]] : [];
        currentLen = currentBatch.reduce((sum, l) => sum + l.length + 1, 0);
      }
      currentBatch.push(line);
      currentLen += line.length + 1;
    }
    
    if (currentBatch.length > 0) {
      results.push({
        ...segment,
        text: currentBatch.join('\n')
      });
    }
    
    return results.length > 0 ? results : [segment];
  }
  
  // Strategy 1: Try splitting by sentence boundaries
  // More robust regex that handles multiple sentence endings and edge cases
  const sentencePattern = /[^.!?\n]+(?:[.!?]+|\n|$)/g;
  let parts: string[] = text.match(sentencePattern) || [];
  
  // Strategy 2: If no sentences found or still too long, split by newlines/paragraphs
  if (parts.length <= 1) {
    parts = text.split(/\n\n+/).filter(s => s.trim().length > 0);
  }
  
  // Strategy 3: If still just one block, split by single newlines
  if (parts.length <= 1) {
    parts = text.split(/\n/).filter(s => s.trim().length > 0);
  }
  
  // Strategy 4: If STILL one giant block (no newlines), do hard character splits
  if (parts.length <= 1 && text.length > targetChars) {
    const hardChunks: StructuralSegment[] = [];
    let pos = 0;
    while (pos < text.length) {
      // Try to find a good break point (space, punctuation) near target
      let endPos = Math.min(pos + targetChars, text.length);
      if (endPos < text.length) {
        // Look for last space/punctuation within last 20% of chunk
        const searchStart = Math.max(pos, endPos - Math.floor(targetChars * 0.2));
        const searchRegion = text.slice(searchStart, endPos);
        const lastBreak = Math.max(
          searchRegion.lastIndexOf(' '),
          searchRegion.lastIndexOf('.'),
          searchRegion.lastIndexOf(','),
          searchRegion.lastIndexOf('\n')
        );
        if (lastBreak > 0) {
          endPos = searchStart + lastBreak + 1;
        }
      }
      
      const chunkText = text.slice(pos, endPos).trim();
      if (chunkText.length > 0) {
        hardChunks.push({
          ...segment,
          text: chunkText,
          startIdx: segment.startIdx + pos,
          endIdx: segment.startIdx + endPos,
        });
      }
      
      // Move forward with small overlap for context
      pos = endPos - overlapChars;
      if (pos <= (hardChunks.length > 0 ? endPos - targetChars : 0)) {
        pos = endPos; // Prevent infinite loop
      }
    }
    return hardChunks.length > 0 ? hardChunks : [segment];
  }
  
  // Normal sentence/paragraph batching
  let currentBatch: string[] = [];
  let currentLen = 0;
  
  for (const part of parts) {
    const partLen = part.length;
    
    // If this single part is bigger than target, recursively split it
    if (partLen > targetChars * 1.5 && currentBatch.length === 0) {
      const subSegment: StructuralSegment = { ...segment, text: part };
      results.push(...splitLongSegment(subSegment, targetChars, overlapChars));
      continue;
    }
    
    if (currentLen + partLen > targetChars && currentBatch.length > 0) {
      results.push({
        ...segment,
        text: currentBatch.join(' ').trim()
      });
      // Keep last part for overlap context
      currentBatch = currentBatch.length > 0 ? [currentBatch[currentBatch.length - 1]] : [];
      currentLen = currentBatch.reduce((sum, s) => sum + s.length + 1, 0);
    }
    currentBatch.push(part.trim());
    currentLen += partLen + 1;
  }
  
  if (currentBatch.length > 0) {
    results.push({
      ...segment,
      text: currentBatch.join(' ').trim()
    });
  }
  
  return results.length > 0 ? results : [segment];
}

/**
 * Merge small adjacent segments of the same type
 */
function mergeSmallSegments(
  segments: StructuralSegment[],
  minChars: number
): StructuralSegment[] {
  const results: StructuralSegment[] = [];
  
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    
    // If segment is large enough, keep it
    if (seg.text.length >= minChars || seg.type === 'heading') {
      results.push(seg);
      continue;
    }
    
    // Try to merge with previous segment of same heading context
    const prev = results[results.length - 1];
    if (prev && prev.headingContext === seg.headingContext && prev.type !== 'heading') {
      const merged = prev.text + '\n\n' + seg.text;
      if (merged.length <= 1400) { // Don't exceed target max
        prev.text = merged;
        prev.endIdx = seg.endIdx;
        continue;
      }
    }
    
    // Otherwise keep small segment
    results.push(seg);
  }
  
  return results;
}

export interface SmartChunkOptions {
  targetTokens?: number;      // Target tokens per chunk (default: 800 for ~1 page)
  minTokens?: number;         // Minimum tokens per chunk (default: 200)
  maxTokens?: number;         // Maximum tokens per chunk (default: 1500)
  overlapTokens?: number;     // Overlap tokens for context (default: 50)
  pages?: string[];           // Pre-split page texts for page-wise chunking
}

/**
 * Split a single page into smaller chunks when it exceeds max size.
 * Tries to split at paragraph/sentence boundaries.
 */
function splitPageIntoChunks(pageText: string, pageNum: number, maxChars: number, overlapChars: number): string[] {
  if (pageText.length <= maxChars) {
    return [pageText];
  }
  
  const chunks: string[] = [];
  
  // Try splitting by paragraphs first (double newlines or single newlines)
  let parts = pageText.split(/\n\n+/).filter(p => p.trim().length > 0);
  if (parts.length <= 1) {
    parts = pageText.split(/\n/).filter(p => p.trim().length > 0);
  }
  
  // If still no good splits, split by sentences
  if (parts.length <= 1) {
    parts = pageText.match(/[^.!?]+[.!?]+/g) || [];
    if (parts.length === 0) {
      // Last resort: hard split by character count
      let pos = 0;
      while (pos < pageText.length) {
        let endPos = Math.min(pos + maxChars, pageText.length);
        // Try to find a space near the end
        if (endPos < pageText.length) {
          const lastSpace = pageText.lastIndexOf(' ', endPos);
          if (lastSpace > pos + maxChars * 0.7) {
            endPos = lastSpace;
          }
        }
        chunks.push(pageText.slice(pos, endPos).trim());
        pos = endPos - overlapChars;
        if (pos <= (chunks.length > 0 ? endPos - maxChars : 0)) pos = endPos;
      }
      return chunks.filter(c => c.length > 0);
    }
  }
  
  // Batch parts into chunks that fit within maxChars
  let currentChunk: string[] = [];
  let currentLen = 0;
  
  for (const part of parts) {
    const partLen = part.length;
    
    if (currentLen + partLen > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n').trim());
      // Keep last part for overlap
      currentChunk = [currentChunk[currentChunk.length - 1]];
      currentLen = currentChunk[0]?.length || 0;
    }
    
    currentChunk.push(part.trim());
    currentLen += partLen + 1;
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n').trim());
  }
  
  return chunks.filter(c => c.length > 0);
}

/**
 * Enterprise-grade smart chunking with structure awareness.
 * Prefers page-wise chunking when pages array is provided.
 */
export function smartChunkText(text: string, opts?: SmartChunkOptions): SmartChunk[] {
  const targetTokens = opts?.targetTokens ?? 800;
  const minTokens = opts?.minTokens ?? 200;
  const maxTokens = opts?.maxTokens ?? 1500;
  const overlapTokens = opts?.overlapTokens ?? 50;
  const pages = opts?.pages;
  
  // Convert to characters (rough: 1 token ≈ 4 chars)
  const targetChars = targetTokens * 4;
  const minChars = minTokens * 4;
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;
  
  // ===== PAGE-WISE CHUNKING (preferred when pages available) =====
  if (pages && pages.length > 0) {
    console.log(`[rag:smartChunk] using page-wise chunking, ${pages.length} pages`);
    
    const chunks: SmartChunk[] = [];
    let charOffset = 0;
    
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const pageText = pages[pageIdx].trim();
      if (pageText.length === 0) continue;
      
      const pageStart = charOffset;
      const pageEnd = charOffset + pageText.length;
      charOffset = pageEnd + 20; // Account for page boundary marker
      
      // If page is small enough, keep as single chunk
      if (pageText.length <= maxChars) {
        const chunkText = `[Page ${pageIdx + 1}]\n${pageText}`;
        const chunkType = classifyChunkType(pageText, null);
        
        chunks.push({
          text: chunkText,
          chunkType,
          headingContext: `Page ${pageIdx + 1}`,
          chunkIndex: chunks.length,
          charStart: pageStart,
          charEnd: pageEnd,
          tokenEstimate: estimateTokens(chunkText),
          products: extractProducts(pageText, null),
          keywords: extractKeywords(pageText),
          prices: extractPrices(pageText),
          question: extractQuestion(pageText, chunkType),
          contextBefore: pageIdx > 0 ? getContextSummary(pages[pageIdx - 1], 150) : "",
          contextAfter: pageIdx < pages.length - 1 ? getContextSummary(pages[pageIdx + 1], 150) : "",
        });
      } else {
        // Page is too large, split it into sub-chunks but keep page context
        const subChunks = splitPageIntoChunks(pageText, pageIdx + 1, maxChars, overlapChars);
        
        for (let subIdx = 0; subIdx < subChunks.length; subIdx++) {
          const subText = subChunks[subIdx];
          const chunkText = `[Page ${pageIdx + 1}, Part ${subIdx + 1}/${subChunks.length}]\n${subText}`;
          const chunkType = classifyChunkType(subText, null);
          
          chunks.push({
            text: chunkText,
            chunkType,
            headingContext: `Page ${pageIdx + 1}`,
            chunkIndex: chunks.length,
            charStart: pageStart,
            charEnd: pageEnd,
            tokenEstimate: estimateTokens(chunkText),
            products: extractProducts(subText, null),
            keywords: extractKeywords(subText),
            prices: extractPrices(subText),
            question: extractQuestion(subText, chunkType),
            contextBefore: subIdx > 0 ? getContextSummary(subChunks[subIdx - 1], 150) : (pageIdx > 0 ? getContextSummary(pages[pageIdx - 1], 150) : ""),
            contextAfter: subIdx < subChunks.length - 1 ? getContextSummary(subChunks[subIdx + 1], 150) : (pageIdx < pages.length - 1 ? getContextSummary(pages[pageIdx + 1], 150) : ""),
          });
        }
      }
    }
    
    console.log(`[rag:smartChunk] page-wise chunks=${chunks.length} avgTokens=${
      chunks.length ? Math.round(chunks.reduce((sum, c) => sum + c.tokenEstimate, 0) / chunks.length) : 0
    }`);
    
    return chunks;
  }
  
  // ===== FALLBACK: Structure-based chunking when no pages =====
  console.log(`[rag:smartChunk] no pages array, using structure-based chunking`);
  
  // Step 1: Segment by structure
  let segments = segmentByStructure(text);
  
  console.log(`[rag:smartChunk] initial segments=${segments.length}`);
  
  // Step 2: Split long segments
  const splitSegments: StructuralSegment[] = [];
  for (const seg of segments) {
    splitSegments.push(...splitLongSegment(seg, maxChars, overlapChars));
  }
  
  console.log(`[rag:smartChunk] after split=${splitSegments.length}`);
  
  // Step 3: Merge small segments
  const mergedSegments = mergeSmallSegments(splitSegments, minChars);
  
  console.log(`[rag:smartChunk] after merge=${mergedSegments.length}`);
  
  // Step 4: Convert to SmartChunks with classification and entity extraction
  const chunks: SmartChunk[] = [];
  
  for (let i = 0; i < mergedSegments.length; i++) {
    const seg = mergedSegments[i];
    
    // Skip pure heading segments - they're included in context
    if (seg.type === 'heading' && seg.text.length < 100) {
      continue;
    }
    
    // Add heading context to chunk for better retrieval
    let chunkText = seg.text;
    if (seg.headingContext && !chunkText.toLowerCase().includes(seg.headingContext.toLowerCase())) {
      chunkText = `[${seg.headingContext}]\n${chunkText}`;
    }
    
    const trimmedText = chunkText.trim();
    const chunkType = classifyChunkType(trimmedText, seg.headingContext);
    
    // Get context from adjacent segments
    const prevSeg = i > 0 ? mergedSegments[i - 1] : null;
    const nextSeg = i < mergedSegments.length - 1 ? mergedSegments[i + 1] : null;
    
    chunks.push({
      text: trimmedText,
      chunkType,
      headingContext: seg.headingContext,
      chunkIndex: chunks.length,
      charStart: seg.startIdx,
      charEnd: seg.endIdx,
      tokenEstimate: estimateTokens(trimmedText),
      // Enhanced metadata for enterprise retrieval
      products: extractProducts(trimmedText, seg.headingContext),
      keywords: extractKeywords(trimmedText),
      prices: extractPrices(trimmedText),
      question: extractQuestion(trimmedText, chunkType),
      contextBefore: getContextSummary(prevSeg?.text),
      contextAfter: getContextSummary(nextSeg?.text),
    });
  }
  
  console.log(`[rag:smartChunk] final chunks=${chunks.length} avgTokens=${
    chunks.length ? Math.round(chunks.reduce((sum, c) => sum + c.tokenEstimate, 0) / chunks.length) : 0
  }`);
  
  return chunks;
}

/**
 * Batch classify chunk types using LLM for higher accuracy (optional enhancement)
 */
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (openaiClient) return openaiClient;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  openaiClient = new OpenAI({ apiKey: key });
  return openaiClient;
}

export async function classifyChunksWithLLM(chunks: SmartChunk[]): Promise<SmartChunk[]> {
  if (chunks.length === 0) return chunks;
  
  const client = getOpenAI();
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  
  // Process in batches of 20 for efficiency
  const batchSize = 20;
  const results: SmartChunk[] = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    
    const prompt = `Classify each text chunk into EXACTLY ONE category. Return a JSON array of category strings.

Categories:
- "pricing": Contains prices, costs, fees, rates, discounts
- "policy": Contains rules, terms, conditions, requirements
- "faq": Q&A format, frequently asked questions
- "example_dialogue": Sample conversations, chat examples
- "contact_info": Address, phone, email, location, hours
- "product_info": Product descriptions, inventory, stock info
- "general": Other business information

Chunks:
${batch.map((c, idx) => `[${idx}] ${c.text.slice(0, 300)}${c.text.length > 300 ? '...' : ''}`).join('\n\n')}

Return ONLY a JSON array like: ["pricing", "policy", "general", ...]`;

    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0,
      });
      
      const content = response.choices[0]?.message?.content || "[]";
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        const types = JSON.parse(match[0]) as ChunkType[];
        for (let j = 0; j < batch.length; j++) {
          results.push({
            ...batch[j],
            chunkType: types[j] || batch[j].chunkType
          });
        }
      } else {
        results.push(...batch);
      }
    } catch (err) {
      console.error(`[rag:smartChunk] LLM classification failed, using heuristics:`, err);
      results.push(...batch);
    }
  }
  
  return results;
}

// Legacy compatibility - simple chunking
export function chunkText(text: string, opts?: { chunkSize?: number; overlap?: number }): string[] {
  const chunks = smartChunkText(text, {
    targetTokens: Math.round((opts?.chunkSize || 900) / 4),
    overlapTokens: Math.round((opts?.overlap || 120) / 4),
  });
  return chunks.map(c => c.text);
}
