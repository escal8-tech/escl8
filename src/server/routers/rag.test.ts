import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { DOC_TYPES } from "../../lib/rag-documents";

const docTypeSchema = z.enum(DOC_TYPES);
const chunkTypeSchema = z.enum(["pricing", "policy", "faq", "example_dialogue", "contact_info", "product_info", "product_index", "section_abstract", "section_full", "general"]);

test("enqueueRetrain input validation", () => {
  const schema = z.object({ email: z.string().email(), docType: docTypeSchema });

  assert.doesNotThrow(() => schema.parse({ email: "test@example.com", docType: "inventory" }));
  assert.throws(() => schema.parse({ email: "invalid-email", docType: "inventory" }));
  // @ts-ignore
  assert.throws(() => schema.parse({ email: "test@example.com", docType: "invalid-doc" }));
});

test("regenerateInstructions input validation", () => {
  const schema = z.object({ email: z.string().email() });
  assert.doesNotThrow(() => schema.parse({ email: "test@example.com" }));
});

test("retrieve input validation", () => {
  const schema = z.object({
    email: z.string().email(),
    query: z.string().min(1).max(1000),
    options: z.object({
      topK: z.number().int().min(1).max(20).optional(),
      docTypes: z.array(docTypeSchema).optional(),
      chunkTypes: z.array(chunkTypeSchema).optional(),
      useReranking: z.boolean().optional(),
      useQueryExpansion: z.boolean().optional(),
    }).optional(),
  });

  assert.doesNotThrow(() => schema.parse({ email: "test@example.com", query: "What is the price?" }));
  assert.doesNotThrow(() => schema.parse({
    email: "test@example.com",
    query: "Stock level",
    options: { topK: 10, docTypes: ["inventory"] }
  }));

  assert.throws(() => schema.parse({ email: "test@example.com", query: "" }));
});
