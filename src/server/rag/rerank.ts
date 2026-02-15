/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Enterprise-grade LLM reranker for RAG.
 * 
 * Takes top-K vector search results and reranks using:
 * - Relevance scoring with LLM
 * - Cross-attention between query and passages
 * - Confidence thresholding to filter low-quality matches
 */

import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  client = new OpenAI({ apiKey: key });
  return client;
}

export interface RankedChunk {
  id: string;
  text: string;
  score: number;          // Original vector similarity score
  rerankScore: number;    // LLM rerank score (0-10)
  relevanceLabel: 'high' | 'medium' | 'low' | 'none';
  metadata: Record<string, any>;
}

export interface RetrievedChunk {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, any>;
}

/**
 * LLM-based reranking with relevance scoring
 */
export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  options?: {
    topK?: number;
    minScore?: number;
    model?: string;
  }
): Promise<RankedChunk[]> {
  const topK = options?.topK ?? 5;
  const minScore = options?.minScore ?? 3;
  const model = options?.model || process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  
  if (chunks.length === 0) return [];
  
  const client = getClient();
  
  // Process in batches to avoid token limits
  const batchSize = 10;
  const allScored: RankedChunk[] = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    
    const systemPrompt = `You are a relevance scorer for a business FAQ/product search system.
Score how relevant each passage is to answering the user's question.

Scoring guide:
- 10: Perfect match, directly answers the question with specific details
- 8-9: Very relevant, contains most of the needed information
- 6-7: Somewhat relevant, contains partial or related information
- 4-5: Tangentially related, might provide useful context
- 1-3: Barely relevant, only loosely connected
- 0: Not relevant at all

Output ONLY a JSON array of scores like: [8, 5, 2, 9, ...]`;

    const passages = batch.map((c, idx) => 
      `[${idx}] ${c.text.slice(0, 500)}${c.text.length > 500 ? '...' : ''}`
    ).join('\n\n');
    
    const userPrompt = `User question: "${query}"

Passages to score:
${passages}

Return JSON array of ${batch.length} scores (0-10):`;

    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 100,
        temperature: 0,
      });
      
      const content = response.choices[0]?.message?.content || "[]";
      const match = content.match(/\[[\s\S]*?\]/);
      
      let scores: number[] = [];
      if (match) {
        try {
          scores = JSON.parse(match[0]) as number[];
        } catch {
          scores = [];
        }
      }
      
      // Assign scores
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const rerankScore = scores[j] ?? 5; // Default to medium if parsing fails
        
        let relevanceLabel: RankedChunk['relevanceLabel'];
        if (rerankScore >= 8) relevanceLabel = 'high';
        else if (rerankScore >= 5) relevanceLabel = 'medium';
        else if (rerankScore >= 2) relevanceLabel = 'low';
        else relevanceLabel = 'none';
        
        allScored.push({
          id: chunk.id,
          text: chunk.text,
          score: chunk.score,
          rerankScore,
          relevanceLabel,
          metadata: chunk.metadata,
        });
      }
    } catch (err) {
      console.error(`[rag:rerank] LLM scoring failed, using vector scores:`, err);
      // Fallback: use vector scores scaled to 0-10
      for (const chunk of batch) {
        allScored.push({
          id: chunk.id,
          text: chunk.text,
          score: chunk.score,
          rerankScore: Math.round(chunk.score * 10),
          relevanceLabel: chunk.score >= 0.8 ? 'high' : chunk.score >= 0.5 ? 'medium' : 'low',
          metadata: chunk.metadata,
        });
      }
    }
  }
  
  // Sort by rerank score descending
  allScored.sort((a, b) => b.rerankScore - a.rerankScore);
  
  // Filter by minimum score and take top K
  const filtered = allScored
    .filter(c => c.rerankScore >= minScore)
    .slice(0, topK);
  
  console.log(`[rag:rerank] input=${chunks.length} scored=${allScored.length} filtered=${filtered.length} topScore=${filtered[0]?.rerankScore ?? 0}`);
  
  return filtered;
}

/**
 * Fast relevance filtering without LLM (keyword + embedding score combo)
 */
export function fastFilter(
  query: string,
  chunks: RetrievedChunk[],
  options?: { minScore?: number; topK?: number }
): RetrievedChunk[] {
  const minScore = options?.minScore ?? 0.65;
  const topK = options?.topK ?? 10;
  
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  
  const scored = chunks.map(chunk => {
    const textLower = chunk.text.toLowerCase();
    
    // Keyword overlap bonus
    const keywordMatches = queryTerms.filter(term => textLower.includes(term)).length;
    const keywordBonus = Math.min(keywordMatches * 0.05, 0.15);
    
    // Combined score
    const combinedScore = chunk.score + keywordBonus;
    
    return { ...chunk, score: combinedScore };
  });
  
  return scored
    .filter(c => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Deduplicate chunks that are too similar
 */
export function deduplicateChunks(chunks: RankedChunk[], similarityThreshold = 0.85): RankedChunk[] {
  const results: RankedChunk[] = [];
  
  for (const chunk of chunks) {
    // Check if too similar to any already selected chunk
    const isDuplicate = results.some(selected => {
      const overlap = calculateTextOverlap(chunk.text, selected.text);
      return overlap > similarityThreshold;
    });
    
    if (!isDuplicate) {
      results.push(chunk);
    }
  }
  
  return results;
}

/**
 * Calculate text overlap ratio (Jaccard-like)
 */
function calculateTextOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  
  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

