import OpenAI from "openai";
import { db } from "../db/client";
import { trainingDocuments, businesses } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { downloadBlobToBuffer } from "./blob";
import { extractTextFromBuffer } from "./extractText";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  client = new OpenAI({ apiKey: key });
  return client;
}

/**
 * Check if all 3 key document types (considerations, conversations, inventory) are indexed
 */
export async function areKeyDocsIndexed(businessId: string): Promise<boolean> {
  const keyDocTypes = ["considerations", "conversations", "inventory"] as const;
  
  const docs = await db
    .select()
    .from(trainingDocuments)
    .where(eq(trainingDocuments.businessId, businessId));

  const indexedDocs = docs.filter(d => d.indexingStatus === "indexed");
  const indexedTypes = new Set(indexedDocs.map(d => d.docType));

  return keyDocTypes.every(type => indexedTypes.has(type));
}

/**
 * Extract text content from uploaded documents for a business
 */
async function getDocumentTexts(businessId: string): Promise<{
  considerations: string | null;
  conversations: string | null;
  inventory: string | null;
}> {
  const keyDocTypes = ["considerations", "conversations", "inventory"] as const;
  
  const docs = await db
    .select()
    .from(trainingDocuments)
    .where(eq(trainingDocuments.businessId, businessId));

  const result: Record<string, string | null> = {
    considerations: null,
    conversations: null,
    inventory: null,
  };

  for (const docType of keyDocTypes) {
    const doc = docs.find(d => d.docType === docType && d.indexingStatus === "indexed");
    if (!doc) continue;

    try {
      const blob = await downloadBlobToBuffer(doc.blobPath);
      const extracted = await extractTextFromBuffer({
        buffer: blob.buffer,
        filename: doc.originalFilename,
        contentType: doc.contentType ?? blob.contentType,
      });
      // Limit text to avoid token limits (approx 15k chars each)
      result[docType] = extracted.text.slice(0, 15000);
    } catch (err) {
      console.error(`[rag:generateBotInstructions] Failed to extract ${docType}: ${err}`);
    }
  }

  return result as any;
}

/**
 * Generate bot personality/behavior instructions based on uploaded documents.
 * This creates a detailed instruction set for the bot's personality, formality,
 * communication style, and behavior guidelines - WITHOUT language specifics.
 */
export async function generateBotInstructions(businessId: string): Promise<string | null> {
  console.log(`[rag:generateBotInstructions] Starting for businessId=${businessId}`);

  const docTexts = await getDocumentTexts(businessId);
  
  if (!docTexts.considerations && !docTexts.conversations && !docTexts.inventory) {
    console.log(`[rag:generateBotInstructions] No document texts available, skipping`);
    return null;
  }

  const openai = getClient();
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

  const systemPrompt = `You are an expert at creating detailed WhatsApp business assistant personality profiles.
Your task is to analyze the business documents provided and create a comprehensive bot instruction set.

The instruction set should define:
1. BOT IDENTITY: What the bot represents (the business, role, relationship to customer)
2. PERSONALITY TRAITS: Warmth level, friendliness, professionalism balance
3. COMMUNICATION STYLE: Tone (casual/formal/mixed), sentence structure preferences, emoji usage level
4. DOMAIN EXPERTISE: What the business sells/offers, key value propositions
5. BEHAVIORAL GUIDELINES: How to handle inquiries, complaints, pricing questions, availability
6. CUSTOMER INTERACTION PATTERNS: Greeting style, closing style, follow-up behavior
7. FORMALITY LEVEL: How formal or casual the responses should be

IMPORTANT RULES:
- Do NOT mention specific languages - the bot should work in any language
- Do NOT include specific prices or stock details (these come from embeddings at runtime)
- Focus on PERSONALITY and BEHAVIOR, not factual business data
- Keep the instruction concise but detailed enough to shape consistent personality
- The output should be 3-5 short paragraphs that define the bot's character

Output ONLY the bot instruction text, no explanations or headers.`;

  const userPrompt = `Analyze these business documents and create a detailed bot personality instruction:

${docTexts.considerations ? `=== AI AGENT CONSIDERATIONS (Guidelines/Policies) ===
${docTexts.considerations}

` : ""}${docTexts.conversations ? `=== SAMPLE CONVERSATIONS (Tone/Style Examples) ===
${docTexts.conversations}

` : ""}${docTexts.inventory ? `=== PRODUCT/SERVICE CATALOG (What They Sell) ===
${docTexts.inventory}
` : ""}

Based on the above, create a bot personality instruction that defines how this business assistant should communicate, its personality traits, formality level, and interaction style. The instruction should help the bot sound natural and consistent with the business's brand and communication patterns.`;

  try {
    console.log(`[rag:generateBotInstructions] Calling OpenAI model=${model}`);
    
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const instructions = response.choices[0]?.message?.content?.trim();
    
    if (!instructions) {
      console.error(`[rag:generateBotInstructions] Empty response from OpenAI`);
      return null;
    }

    console.log(`[rag:generateBotInstructions] Generated instructions (${instructions.length} chars)`);
    return instructions;
  } catch (err: any) {
    console.error(`[rag:generateBotInstructions] OpenAI error: ${err?.message || String(err)}`);
    return null;
  }
}

/**
 * Generate and save bot instructions to the business record
 */
export async function generateAndSaveBotInstructions(businessId: string): Promise<boolean> {
  const areAllIndexed = await areKeyDocsIndexed(businessId);
  
  if (!areAllIndexed) {
    console.log(`[rag:generateBotInstructions] Not all key docs indexed for businessId=${businessId}, skipping instruction generation`);
    return false;
  }

  const instructions = await generateBotInstructions(businessId);
  
  if (!instructions) {
    console.log(`[rag:generateBotInstructions] No instructions generated for businessId=${businessId}`);
    return false;
  }

  try {
    await db
      .update(businesses)
      .set({
        instructions,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));

    console.log(`[rag:generateBotInstructions] Saved instructions for businessId=${businessId}`);
    return true;
  } catch (err: any) {
    console.error(`[rag:generateBotInstructions] Failed to save instructions: ${err?.message || String(err)}`);
    return false;
  }
}
