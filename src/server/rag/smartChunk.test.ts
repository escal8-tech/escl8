import test from "node:test";
import assert from "node:assert/strict";

// We need to import the functions to test. Since they might not be exported,
// we might need to export them in smartChunk.ts or test the main entry point if it exists.
// Looking at the file, it seems most functions are internal.
// Let's see if there are any exported functions.

import { ChunkType } from "./smartChunk";

// For the purpose of this test, let's assume we want to test the classification logic
// or any exported utility. If the file only exports the type, we might need to
// look for the main chunking function which was likely at the end of the file.

import { smartChunkText } from "./smartChunk";

test("smartChunkText handles basic text", () => {
  const text = "This is a simple test document for chunking logic verification.";
  const chunks = smartChunkText(text);
  assert.equal(chunks.length >= 1, true);
  assert.equal(chunks[0].text.includes("simple test"), true);
});

test("smartChunkText identifies pricing content", () => {
  const text = "Product A costs RM 150.00. Payment can be made via bank transfer.";
  const chunks = smartChunkText(text);
  const pricingChunk = chunks.find(c => c.chunkType === "pricing");
  assert.ok(pricingChunk);
  assert.equal(pricingChunk.prices.includes("RM 150.00"), true);
});

test("smartChunkText identifies FAQ content", () => {
  const text = "Question: How do I return an item?\nAnswer: You can return it within 30 days.";
  const chunks = smartChunkText(text);
  const faqChunk = chunks.find(c => c.chunkType === "faq");
  assert.ok(faqChunk);
  assert.equal(faqChunk.question, "How do I return an item?");
});
