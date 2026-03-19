import { recordGrafanaLog, type GrafanaLogLevel } from "@/lib/grafana-monitoring";

const APP_NAME = "escl8-agent-dashboard";

type MonitoringPrimitive = string | number | boolean | null | undefined;
export type BusinessEventAttributes = Record<string, MonitoringPrimitive>;

type BusinessEventInput = {
  event: string;
  level?: GrafanaLogLevel;
  source?: string;
  action?: string | null;
  area?: string | null;
  outcome?: string | null;
  businessId?: string | null;
  entity?: string | null;
  entityId?: string | number | null;
  userId?: string | null;
  actorId?: string | number | null;
  actorType?: string | null;
  messageId?: string | null;
  phoneNumberId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  attributes?: BusinessEventAttributes;
};

function normalizeScalar(value: MonitoringPrimitive): string | number | boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized.slice(0, 1000) : undefined;
  }
  return value;
}

function normalizeAttributes(
  attributes: BusinessEventAttributes = {},
): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes)) {
    const scalar = normalizeScalar(value);
    if (scalar != null) {
      normalized[key] = scalar;
    }
  }

  return normalized;
}

function inferArea(event: string, entity?: string | null): string {
  const normalized = `${event} ${entity || ""}`.trim().toLowerCase();
  if (normalized.includes("auth")) return "auth";
  if (normalized.includes("upload")) return "upload";
  if (normalized.includes("whatsapp")) return "whatsapp";
  if (normalized.includes("rag")) return "rag";
  if (normalized.includes("message")) return "message";
  if (normalized.includes("ticket")) return "ticket";
  if (normalized.includes("customer")) return "customer";
  if (normalized.includes("realtime") || normalized.includes("pubsub")) return "realtime";
  return "app";
}

export function recordBusinessEvent(input: BusinessEventInput): void {
  const event = String(input.event || "").trim() || "business.event";

  recordGrafanaLog(
    input.level || "info",
    event,
    normalizeAttributes({
      app_name: APP_NAME,
      log_source: "business",
      event_kind: "business",
      business_event: event,
      action: input.action || event,
      area: input.area || inferArea(event, input.entity),
      outcome: input.outcome,
      business_id: input.businessId,
      entity: input.entity,
      entity_id: input.entityId,
      user_id: input.userId,
      actor_id: input.actorId,
      actor_type: input.actorType,
      message_id: input.messageId,
      phone_number_id: input.phoneNumberId,
      session_id: input.sessionId,
      status: input.status,
      ...(input.attributes || {}),
    }),
    {
      source: input.source || "business",
    },
  );
}
