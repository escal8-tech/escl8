import { recordGrafanaLog, type GrafanaLogLevel } from "@/lib/grafana-monitoring";
import { enrichBusinessFailureTaxonomy } from "@/lib/failure-taxonomy";
import { captureSentryException } from "@/lib/sentry-monitoring";

type MonitoringPrimitive = string | number | boolean | null | undefined;
type MonitoringAttributes = Record<string, MonitoringPrimitive>;
const CLIENT_ERROR_REPORTED_FLAG = Symbol.for("escal8.client-error-reported");
const HANDLED_CLIENT_AUTH_ERROR_CODES = new Set([
  "auth/account-exists-with-different-credential",
  "auth/cancelled-popup-request",
  "auth/email-already-in-use",
  "auth/invalid-credential",
  "auth/invalid-email",
  "auth/popup-closed-by-user",
  "auth/requires-recent-login",
  "auth/too-many-requests",
  "auth/user-mismatch",
  "auth/user-not-found",
  "auth/weak-password",
  "auth/wrong-password",
]);

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.trim().toLowerCase() : "";
}

export function isClientErrorReported(error: unknown): boolean {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return false;
  return Boolean((error as Record<PropertyKey, unknown>)[CLIENT_ERROR_REPORTED_FLAG]);
}

export function markClientErrorReported<T>(error: T): T {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return error;

  try {
    Object.defineProperty(error, CLIENT_ERROR_REPORTED_FLAG, {
      configurable: true,
      enumerable: false,
      value: true,
      writable: true,
    });
  } catch {
    (error as Record<PropertyKey, unknown>)[CLIENT_ERROR_REPORTED_FLAG] = true;
  }

  return error;
}

export function shouldCaptureUnexpectedClientError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code.startsWith("permission/")) return false;
  if (!code.startsWith("auth/")) return true;
  return !HANDLED_CLIENT_AUTH_ERROR_CODES.has(code);
}

function normalizeClientBusinessLevel(
  level: GrafanaLogLevel | undefined,
  outcome: string | null | undefined,
): GrafanaLogLevel {
  const resolved = level || "info";
  if (outcome === "handled_failure" && (resolved === "error" || resolved === "fatal")) {
    return "warn";
  }
  return resolved;
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
  const level = normalizeClientBusinessLevel(input.level, input.outcome);
  const shouldCaptureInSentry = Boolean(input.captureInSentry) && input.outcome !== "handled_failure";
  const taxonomyAttributes = enrichBusinessFailureTaxonomy({
    event: input.event,
    level,
    action: input.action,
    area: input.area,
    outcome: input.outcome,
    attributes: input.attributes,
  });
  recordGrafanaLog(
    level,
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
      ...taxonomyAttributes,
    },
    {
      forceClientDelivery: true,
      flushImmediately: shouldCaptureInSentry,
      runtime: "client",
      source: "business",
    },
  );

  if (shouldCaptureInSentry && input.error) {
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
      level: level === "warn" ? "warning" : "error",
      tags: {
        "client.event": input.event,
        route: input.route,
      },
    });
  }
}
