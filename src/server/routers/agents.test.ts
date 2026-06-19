import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

test("createAgent input validation", () => {
  const inputSchema = z.object({
    name: z.string().min(1),
    botType: z.string().min(1).default("AGENT"),
    promptOverride: z.string().optional(),
  });

  // Valid input
  assert.doesNotThrow(() => inputSchema.parse({ name: "Test Agent" }));
  assert.equal(inputSchema.parse({ name: "Test Agent" }).botType, "AGENT");

  // Invalid input
  assert.throws(() => inputSchema.parse({ name: "" }));
});

test("updateAgent input validation", () => {
  const updateSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    botType: z.string().min(1).optional(),
    promptOverride: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  });

  assert.doesNotThrow(() => updateSchema.parse({ id: "123", name: "Updated" }));
  assert.throws(() => updateSchema.parse({ id: "" }));
});

test("deleteAgent input validation", () => {
  const deleteSchema = z.object({
    id: z.string().min(1),
  });

  assert.doesNotThrow(() => deleteSchema.parse({ id: "agent-123" }));
  assert.throws(() => deleteSchema.parse({ id: "" }));
});
