import test from "node:test";
import assert from "node:assert/strict";

import { enrichBusinessFailureTaxonomy } from "@/lib/failure-taxonomy";

test("agent WhatsApp send failures are mapped to a critical failure key", () => {
  const attrs = enrichBusinessFailureTaxonomy({
    event: "whatsapp.message_send_failed",
    level: "warn",
    action: "send",
    area: "whatsapp",
    outcome: "handled_failure",
    status: "meta_graph_error",
    attributes: {},
  });

  assert.equal(attrs.failure_key, "agent.whatsapp.message_send_failed");
  assert.equal(attrs.failure_group, "whatsapp");
  assert.equal(attrs.impact_tier, "critical");
});

test("non-failure events only get scope_module", () => {
  const attrs = enrichBusinessFailureTaxonomy({
    event: "order.payment_submitted",
    level: "info",
    action: "internalOrderPaymentProofPost",
    area: "order",
    outcome: "success",
    status: "submitted",
    attributes: {},
  });

  assert.equal(attrs.scope_module, "order");
  assert.equal(attrs.failure_key, undefined);
});
