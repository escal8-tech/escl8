/**
 * Enterprise-grade query rewriter for RAG.
 * 
 * Expands user queries to improve retrieval recall:
 * - "how much?" → "price cost fee rate pricing discount"
 * - "where are you?" → "address location map directions"
 * - "do you have X?" → "X stock available inventory in stock"
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

export interface RewrittenQuery {
  original: string;
  expanded: string;
  intents: string[];
  suggestedFilters: {
    docTypes?: string[];
    chunkTypes?: string[];
  };
}

// Common query patterns and their expansions
const QUERY_EXPANSIONS: Record<string, { 
  patterns: RegExp[]; 
  expansion: string;
  intents: string[];
  chunkTypes: string[];
}> = {
  pricing: {
    patterns: [
      /\b(?:how much|price|cost|fee|rate|charge|pay|afford|budget|expensive|cheap)\b/i,
      /\b(?:rm|usd|dollar|ringgit|\$|£|€|₹)\s*\d*/i,
      /\bper\s+(?:unit|piece|item|kg|gram|hour|day|month)\b/i,
    ],
    expansion: "price pricing cost fee rate charge payment amount discount offer promotion deal",
    intents: ["get_price", "compare_prices"],
    chunkTypes: ["pricing", "product_info"],
  },
  availability: {
    patterns: [
      /\b(?:do you have|available|in stock|got any|can i get|is there)\b/i,
      /\b(?:stock|inventory|supply)\b/i,
    ],
    expansion: "available stock inventory in stock availability have supply",
    intents: ["check_availability"],
    chunkTypes: ["product_info", "pricing"],
  },
  location: {
    patterns: [
      /\b(?:where|location|address|direction|map|find you|visit|come)\b/i,
      /\b(?:shop|store|outlet|branch|office)\b/i,
    ],
    expansion: "address location direction map shop store outlet visit find",
    intents: ["get_location"],
    chunkTypes: ["contact_info"],
  },
  contact: {
    patterns: [
      /\b(?:contact|call|phone|whatsapp|email|reach|number)\b/i,
      /\b(?:hours|open|close|timing|when)\b/i,
    ],
    expansion: "contact phone call whatsapp email number hours open close timing",
    intents: ["get_contact"],
    chunkTypes: ["contact_info"],
  },
  shipping: {
    patterns: [
      /\b(?:deliver|delivery|ship|shipping|send|courier|postage|cod)\b/i,
      /\b(?:how long|when.*arrive|eta|receive)\b/i,
    ],
    expansion: "delivery shipping ship send courier postage deliver time arrive",
    intents: ["get_shipping_info"],
    chunkTypes: ["policy", "pricing"],
  },
  payment: {
    patterns: [
      /\b(?:pay|payment|bank|transfer|account|fpx|grab.*pay|touch.*go|ewallet)\b/i,
    ],
    expansion: "payment pay bank transfer account method credit card ewallet fpx",
    intents: ["get_payment_info"],
    chunkTypes: ["contact_info", "policy"],
  },
  refund: {
    patterns: [
      /\b(?:refund|return|exchange|cancel|warranty|guarantee)\b/i,
    ],
    expansion: "refund return exchange cancel warranty guarantee policy",
    intents: ["get_refund_policy"],
    chunkTypes: ["policy"],
  },
  product: {
    patterns: [
      /\b(?:what.*sell|product|item|model|type|variant|kind|category)\b/i,
      /\b(?:menu|catalog|list|option)\b/i,
    ],
    expansion: "product item model type variant category option available",
    intents: ["browse_products"],
    chunkTypes: ["product_info", "pricing"],
  },
};

/**
 * Fast heuristic-based query expansion (no LLM call)
 */
export function expandQueryHeuristic(query: string): RewrittenQuery {
  const lowerQuery = query.toLowerCase();
  const matchedExpansions: string[] = [];
  const matchedIntents: string[] = [];
  const matchedChunkTypes = new Set<string>();
  
  for (const [_key, config] of Object.entries(QUERY_EXPANSIONS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(lowerQuery)) {
        matchedExpansions.push(config.expansion);
        matchedIntents.push(...config.intents);
        config.chunkTypes.forEach(ct => matchedChunkTypes.add(ct));
        break; // Only match once per category
      }
    }
  }
  
  // Build expanded query
  const uniqueExpansions = [...new Set(matchedExpansions.join(' ').split(' '))];
  const expanded = matchedExpansions.length > 0
    ? `${query} ${uniqueExpansions.join(' ')}`
    : query;
  
  return {
    original: query,
    expanded: expanded.slice(0, 1000), // Limit length
    intents: [...new Set(matchedIntents)],
    suggestedFilters: {
      chunkTypes: matchedChunkTypes.size > 0 ? [...matchedChunkTypes] : undefined,
    },
  };
}

/**
 * LLM-powered query expansion for complex queries
 */
export async function expandQueryWithLLM(query: string): Promise<RewrittenQuery> {
  // First apply heuristics
  const heuristic = expandQueryHeuristic(query);
  
  // For very short or simple queries, just use heuristics
  if (query.length < 20 || heuristic.intents.length > 0) {
    return heuristic;
  }
  
  const client = getClient();
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  
  const systemPrompt = `You are a search query optimizer for a WhatsApp business bot.
Your task is to expand a user's natural language query into a search-optimized version.

Rules:
1. Keep the original query meaning
2. Add synonyms and related terms that might appear in business documents
3. Include both formal and informal variations
4. Output ONLY the expanded query, no explanations
5. Keep it under 150 words
6. Do not add unrelated topics`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Expand this search query: "${query}"` }
      ],
      max_tokens: 200,
      temperature: 0.3,
    });
    
    const expanded = response.choices[0]?.message?.content?.trim() || query;
    
    return {
      original: query,
      expanded: `${query} ${expanded}`.slice(0, 1000),
      intents: heuristic.intents,
      suggestedFilters: heuristic.suggestedFilters,
    };
  } catch (err) {
    console.error(`[rag:queryRewrite] LLM expansion failed:`, err);
    return heuristic;
  }
}

/**
 * Generate multiple search queries for better recall (HyDE-style)
 */
export async function generateHypotheticalAnswers(query: string): Promise<string[]> {
  const client = getClient();
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  
  const systemPrompt = `Generate 3 short hypothetical answer snippets that might appear in a business FAQ or product document for this question. Each should be 1-2 sentences and contain key terms that would match in a search. Output as JSON array.`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query }
      ],
      max_tokens: 300,
      temperature: 0.7,
    });
    
    const content = response.choices[0]?.message?.content || "[]";
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]) as string[];
    }
    return [];
  } catch (err) {
    console.error(`[rag:queryRewrite] HyDE generation failed:`, err);
    return [];
  }
}
