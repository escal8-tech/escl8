/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Enterprise-grade RAG retrieval module.
 * 
 * Complete retrieval pipeline:
 * 1. Query rewriting/expansion
 * 2. Multi-query vector search
 * 3. Metadata filtering
 * 4. LLM reranking
 * 5. Deduplication
 * 6. Context formatting with citations
 */

import { getPineconeIndex } from "./pinecone";
import { embedTexts } from "./embed";
import { expandQueryHeuristic, expandQueryWithLLM, generateHypotheticalAnswers } from "./queryRewrite";
import { rerankChunks, fastFilter, deduplicateChunks, RankedChunk, RetrievedChunk } from "./rerank";

export interface RetrievalOptions {
  // Search options
  topK?: number;              // Final number of chunks to return (default: 5)
  initialK?: number;          // Initial retrieval count for reranking (default: 20)
  minScore?: number;          // Minimum rerank score to include (default: 3)
  
  // Filtering options
  docTypes?: string[];        // Filter by document types
  chunkTypes?: string[];      // Filter by chunk types
  
  // Feature toggles
  useQueryExpansion?: boolean;      // Enable query expansion (default: true)
  useLLMExpansion?: boolean;        // Use LLM for expansion (default: false, uses heuristics)
  useHyDE?: boolean;                // Use hypothetical answer generation (default: false)
  useReranking?: boolean;           // Enable LLM reranking (default: true)
  useDeduplication?: boolean;       // Remove similar chunks (default: true)
}

export interface RetrievalResult {
  chunks: RankedChunk[];
  context: string;            // Formatted context for LLM
  citations: Citation[];      // Source citations
  metadata: {
    originalQuery: string;
    expandedQuery: string;
    totalRetrieved: number;
    totalAfterRerank: number;
    avgScore: number;
  };
}

export interface Citation {
  index: number;
  source: string;
  docType: string;
  chunkType: string;
  snippet: string;
}

/**
 * Main retrieval function - enterprise-grade RAG pipeline
 */
export async function retrieve(
  businessId: string,
  query: string,
  options?: RetrievalOptions
): Promise<RetrievalResult> {
  const opts = {
    topK: options?.topK ?? 5,
    initialK: options?.initialK ?? 20,
    minScore: options?.minScore ?? 3,
    useQueryExpansion: options?.useQueryExpansion ?? true,
    useLLMExpansion: options?.useLLMExpansion ?? false,
    useHyDE: options?.useHyDE ?? false,
    useReranking: options?.useReranking ?? true,
    useDeduplication: options?.useDeduplication ?? true,
    docTypes: options?.docTypes,
    chunkTypes: options?.chunkTypes,
  };

  console.log(`[rag:retrieve] start businessId=${businessId} query="${query.slice(0, 50)}..." opts=${JSON.stringify({
    topK: opts.topK,
    initialK: opts.initialK,
    useReranking: opts.useReranking,
  })}`);

  // Step 1: Query expansion
  let searchQueries: string[] = [query];
  let expandedQuery = query;
  
  if (opts.useQueryExpansion) {
    const expansion = opts.useLLMExpansion 
      ? await expandQueryWithLLM(query)
      : expandQueryHeuristic(query);
    
    expandedQuery = expansion.expanded;
    searchQueries = [expandedQuery];
    
    // Apply suggested filters if not explicitly set
    if (!opts.chunkTypes && expansion.suggestedFilters.chunkTypes?.length) {
      opts.chunkTypes = expansion.suggestedFilters.chunkTypes;
    }
    
    console.log(`[rag:retrieve] expanded query="${expandedQuery.slice(0, 100)}..." intents=${expansion.intents.join(',')}`);
  }
  
  // Step 2: Optional HyDE - generate hypothetical answers
  if (opts.useHyDE) {
    const hypotheticals = await generateHypotheticalAnswers(query);
    searchQueries.push(...hypotheticals);
    console.log(`[rag:retrieve] HyDE generated ${hypotheticals.length} hypothetical answers`);
  }

  // Step 3: Vector search with all queries
  const index = getPineconeIndex();
  const allRetrieved: RetrievedChunk[] = [];
  const seenIds = new Set<string>();
  
  // Embed all search queries
  const queryEmbeddings = await embedTexts(searchQueries);
  
  for (let i = 0; i < searchQueries.length; i++) {
    const queryVector = queryEmbeddings[i];
    
    // Build filter
    const filter: Record<string, any> = { businessId };
    if (opts.docTypes?.length) {
      filter.docType = { $in: opts.docTypes };
    }
    if (opts.chunkTypes?.length) {
      filter.chunkType = { $in: opts.chunkTypes };
    }
    
    try {
      const results = await index.namespace(businessId).query({
        vector: queryVector,
        topK: opts.initialK,
        includeMetadata: true,
        filter: Object.keys(filter).length > 1 ? filter : undefined,
      });
      
      for (const match of results.matches || []) {
        if (seenIds.has(match.id)) continue;
        seenIds.add(match.id);
        
        allRetrieved.push({
          id: match.id,
          text: (match.metadata?.text as string) || "",
          score: match.score || 0,
          metadata: match.metadata as Record<string, any> || {},
        });
      }
    } catch (err) {
      console.error(`[rag:retrieve] Pinecone query failed:`, err);
    }
  }
  
  console.log(`[rag:retrieve] vector search retrieved ${allRetrieved.length} unique chunks`);
  
  if (allRetrieved.length === 0) {
    return {
      chunks: [],
      context: "",
      citations: [],
      metadata: {
        originalQuery: query,
        expandedQuery,
        totalRetrieved: 0,
        totalAfterRerank: 0,
        avgScore: 0,
      },
    };
  }

  // Step 4: Fast filtering to reduce candidates
  const fastFiltered = fastFilter(query, allRetrieved, { 
    minScore: 0.5, 
    topK: Math.min(opts.initialK, allRetrieved.length) 
  });
  
  console.log(`[rag:retrieve] fast filter: ${allRetrieved.length} -> ${fastFiltered.length}`);

  // Step 5: LLM Reranking
  let rankedChunks: RankedChunk[];
  
  if (opts.useReranking && fastFiltered.length > 0) {
    rankedChunks = await rerankChunks(query, fastFiltered, {
      topK: opts.topK * 2, // Get more for deduplication
      minScore: opts.minScore,
    });
  } else {
    // Fallback: use vector scores
    rankedChunks = fastFiltered.slice(0, opts.topK * 2).map(c => ({
      ...c,
      rerankScore: Math.round(c.score * 10),
      relevanceLabel: c.score >= 0.8 ? 'high' as const : c.score >= 0.5 ? 'medium' as const : 'low' as const,
    }));
  }
  
  console.log(`[rag:retrieve] reranked: ${fastFiltered.length} -> ${rankedChunks.length}`);

  // Step 6: Deduplication
  if (opts.useDeduplication) {
    rankedChunks = deduplicateChunks(rankedChunks, 0.7);
    console.log(`[rag:retrieve] deduplicated to ${rankedChunks.length} chunks`);
  }

  // Step 7: Take final top K
  const finalChunks = rankedChunks.slice(0, opts.topK);
  
  // Step 8: Format context and citations
  const { context, citations } = formatContextWithCitations(finalChunks);
  
  const avgScore = finalChunks.length > 0
    ? finalChunks.reduce((sum, c) => sum + c.rerankScore, 0) / finalChunks.length
    : 0;

  console.log(`[rag:retrieve] final: ${finalChunks.length} chunks, avgScore=${avgScore.toFixed(1)}`);

  return {
    chunks: finalChunks,
    context,
    citations,
    metadata: {
      originalQuery: query,
      expandedQuery,
      totalRetrieved: allRetrieved.length,
      totalAfterRerank: rankedChunks.length,
      avgScore,
    },
  };
}

/**
 * Format retrieved chunks into a grounded context block with citations
 */
function formatContextWithCitations(chunks: RankedChunk[]): { context: string; citations: Citation[] } {
  if (chunks.length === 0) {
    return { context: "", citations: [] };
  }

  const citations: Citation[] = [];
  const contextParts: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const citationNum = i + 1;
    
    citations.push({
      index: citationNum,
      source: chunk.metadata.filename || chunk.metadata.source || "unknown",
      docType: chunk.metadata.docType || "general",
      chunkType: chunk.metadata.chunkType || "general",
      snippet: chunk.text.slice(0, 100) + (chunk.text.length > 100 ? "..." : ""),
    });

    // Build enriched chunk text with metadata hints
    let enrichedText = chunk.text;
    
    // Add question context for FAQ chunks
    if (chunk.metadata.question && typeof chunk.metadata.question === 'string' && chunk.metadata.question.length > 0) {
      enrichedText = `Q: ${chunk.metadata.question}\n${enrichedText}`;
    }
    
    // Add price highlights if available
    const prices = chunk.metadata.prices;
    if (prices && typeof prices === 'string' && prices.length > 0) {
      const priceList = prices.split('|').filter(Boolean).slice(0, 5);
      if (priceList.length > 0) {
        enrichedText += `\n[Prices mentioned: ${priceList.join(', ')}]`;
      }
    }
    
    // Add product context if available
    const products = chunk.metadata.products;
    if (products && typeof products === 'string' && products.length > 0) {
      const productList = products.split('|').filter(Boolean).slice(0, 5);
      if (productList.length > 0 && !enrichedText.toLowerCase().includes(productList[0].toLowerCase())) {
        enrichedText += `\n[Products/Services: ${productList.join(', ')}]`;
      }
    }

    // Format chunk with citation marker
    contextParts.push(`[${citationNum}] ${enrichedText}`);
  }

  const context = contextParts.join("\n\n---\n\n");

  return { context, citations };
}

/**
 * Simple retrieval for backward compatibility
 */
export async function simpleRetrieve(
  businessId: string,
  query: string,
  topK: number = 5
): Promise<string[]> {
  const result = await retrieve(businessId, query, {
    topK,
    useReranking: false,
    useQueryExpansion: true,
    useLLMExpansion: false,
  });
  
  return result.chunks.map(c => c.text);
}

/**
 * Get grounded context block for LLM system prompt
 */
export async function getGroundedContext(
  businessId: string,
  query: string,
  options?: RetrievalOptions
): Promise<string> {
  const result = await retrieve(businessId, query, options);
  
  if (result.chunks.length === 0) {
    return "No specific business knowledge found for this query.";
  }
  
  // Build grounded context block
  const header = `=== Business Knowledge (${result.chunks.length} sources) ===`;
  const footer = `=== End Business Knowledge ===`;
  
  const confidenceNote = result.metadata.avgScore >= 7
    ? "High confidence matches found."
    : result.metadata.avgScore >= 4
    ? "Moderate confidence matches found."
    : "Low confidence matches - verify before responding.";
  
  return `${header}
${confidenceNote}

${result.context}

${footer}`;
}

