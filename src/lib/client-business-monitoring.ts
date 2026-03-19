import { recordGrafanaLog, type GrafanaLogLevel } from "@/lib/grafana-monitoring";
import { captureSentryException } from "@/lib/sentry-monitoring";

type MonitoringPrimitive = string | number | boolean | null | undefined;
type MonitoringAttributes = Record<string, MonitoringPrimitive>;

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.trim().toLowerCase() : "";
}

export function shouldCaptureUnexpectedClientError(error: unknown): boolean {
  const code = getErrorCode(error);
  return !(code.startsWith("auth/") || code.startsWith("permission/"));
}

export function recordClientBusinessEvent(input: {
  action?: string;
  area?: string;
  attributes?: MonitoringAttributes;
  captureInSentry?: boolean;
  error?: unknown;
  event: string;
  level?: GrafanaLogLevel;
  outcome?: string | null;
  route?: string | null;
}): void {
  recordGrafanaLog(
    input.level || "info",
    input.event,
    {
      action: input.action || input.event,
      area: input.area || "app",
      business_event: input.event,
      error_code: getErrorCode(input.error),
      event_kind: "business",
      log_source: "business",
      outcome: input.outcome,
      route: input.route,
      ...(input.attributes || {}),
    },
    {
      forceClientDelivery: true,
      runtime: "client",
      source: "business",
    },
  );

  if (input.captureInSentry && input.error) {
    captureSentryException(input.error, {
      action: input.action || input.event,
      area: input.area || "app",
      contexts: {
        client_event: {
          event: input.event,
          route: input.route ?? null,
          ...(input.attributes || {}),
        },
      },
      level: input.level === "warn" ? "warning" : "error",
      tags: {
        "client.event": input.event,
        route: input.route,
      },
    });
  }
}
