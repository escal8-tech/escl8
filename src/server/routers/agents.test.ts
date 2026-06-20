import test from "node:test";
import assert from "node:assert/strict";
import { agentsRouter } from "./agents";

test("agentsRouter has expected procedures", () => {
  assert.ok(agentsRouter.listAgents);
  assert.ok(agentsRouter.createAgent);
  assert.ok(agentsRouter.updateAgent);
  assert.ok(agentsRouter.deleteAgent);
});

// Note: Full integration tests for routers require a complex tRPC + DB mock setup
// which is not currently established in this test suite.
// Logic-heavy routers should ideally have their business logic extracted to services for better testability.
