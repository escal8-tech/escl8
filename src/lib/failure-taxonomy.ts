type MonitoringPrimitive = string | number | boolean | null | undefined

type FailureTaxonomyInput = {
  event: string
  level: string
  action?: string | null
  area?: string | null
  outcome?: string | null
  status?: string | null
  attributes?: Record<string, MonitoringPrimitive>
}

const FAILURE_OUTCOMES = new Set(["failed", "failure", "handled_failure", "unexpected_failure"]);
const FAILURE_STATUSES = new Set([
  "failed",
  "error",
  "meta_graph_error",
  "delivery_failed",
  "realtime.websocket_error",
  "upload_failed",
]);

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isFailure(input: FailureTaxonomyInput): boolean {
  const event = normalized(input.event);
  const level = normalized(input.level);
  const outcome = normalized(input.outcome);
  const status = normalized(input.status);
  if (FAILURE_OUTCOMES.has(outcome) || FAILURE_STATUSES.has(status)) return true;
  if (
    ["warn", "error", "fatal"].includes(level) &&
    (event.endsWith("_failed") || event.endsWith(".failed") || event.includes("websocket_error"))
  ) {
    return true;
  }
  return false;
}

function buildFailureMetadata(input: FailureTaxonomyInput):
  | Record<string, string | boolean>
  | undefined {
  const event = normalized(input.event);

  if (event === "whatsapp.message_send_failed") {
    return {
      failure_group: "whatsapp",
      failure_key: "agent.whatsapp.message_send_failed",
      impact_tier: "critical",
      scope_module: "whatsapp",
    };
  }
  if (event === "whatsapp.identity_connect_failed") {
    return {
      failure_group: "whatsapp",
      failure_key: "agent.whatsapp.identity_connect_failed",
      impact_tier: "high",
      scope_module: "whatsapp",
    };
  }
  if (event === "realtime.websocket_error") {
    return {
      failure_group: "realtime",
      failure_key: "agent.realtime.websocket_error",
      impact_tier: "medium",
      scope_module: "realtime",
    };
  }
  if (event === "order.payment_proof_failed") {
    return {
      failure_group: "payment",
      failure_key: "agent.order.payment_proof_failed",
      impact_tier: "high",
      scope_module: "order",
    };
  }
  return undefined;
}

export function enrichBusinessFailureTaxonomy(
  input: FailureTaxonomyInput
): Record<string, MonitoringPrimitive> {
  const attrs: Record<string, MonitoringPrimitive> = { ...(input.attributes || {}) };
  const scopeModule =
    normalized(input.area) || normalized(input.action) || normalized(input.event).split(".", 1)[0] || "app";
  if (!attrs.scope_module) attrs.scope_module = scopeModule;

  if (!isFailure(input)) {
    return attrs;
  }

  const metadata = buildFailureMetadata(input);
  if (metadata) {
    Object.assign(attrs, metadata);
  } else {
    if (!attrs.failure_group) attrs.failure_group = scopeModule;
    if (!attrs.failure_key) attrs.failure_key = normalized(input.event) || normalized(input.action) || "agent.unknown.failure";
    if (!attrs.impact_tier) attrs.impact_tier = "medium";
  }

  if (!attrs.failure_kind) attrs.failure_kind = "business";
  if (attrs.customer_visible == null) {
    attrs.customer_visible = attrs.impact_tier === "critical" || attrs.impact_tier === "high";
  }
  return attrs;
}
