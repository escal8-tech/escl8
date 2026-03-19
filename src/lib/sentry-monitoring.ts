import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint, Integration, Log } from "@sentry/core";

import { recordGrafanaLog } from "@/lib/grafana-monitoring";

const APP_NAME = "escl8-agent-dashboard";
const MONITORING_VENDOR = "sentry";
const DEFAULT_TRACES_SAMPLE_RATE = 1;
const DEFAULT_LOGS_ENABLED = true;
const DEFAULT_CONSOLE_LOG_CAPTURE_ENABLED = true;
const DEFAULT_SENTRY_MIN_LOG_LEVEL = "error";
const DEFAULT_PROFILE_LIFECYCLE = "trace";
const DEFAULT_PROFILE_SESSION_SAMPLE_RATE = process.env.NODE_ENV === "production" ? 0.2 : 1;
const DEFAULT_SEND_DEFAULT_PII = false;
const LOW_VALUE_LOG_PATTERNS = [/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//, /^(?:○|✓)\s/];
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|set-cookie|token|secret|password|api[-_]?key|session|csrf)/i;
const SENSITIVE_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\bBasic\s+[A-Za-z0-9+/=]+\b/gi,
];
const LOG_LEVEL_PRIORITY: Record<SentryLogThreshold, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  off: 100,
};

const ENV = {
  nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL,
  nextPublicSentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  nextPublicSentryDebug: process.env.NEXT_PUBLIC_SENTRY_DEBUG,
  nextPublicSentryEnableConsoleLogs: process.env.NEXT_PUBLIC_SENTRY_ENABLE_CONSOLE_LOGS,
  nextPublicSentryEnableLogs: process.env.NEXT_PUBLIC_SENTRY_ENABLE_LOGS,
  nextPublicSentryEnvironment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  nextPublicSentryMinLogLevel: process.env.NEXT_PUBLIC_SENTRY_MIN_LOG_LEVEL,
  nextPublicSentryProfileLifecycle: process.env.NEXT_PUBLIC_SENTRY_PROFILE_LIFECYCLE,
  nextPublicSentryProfileSessionSampleRate: process.env.NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE,
  nextPublicSentryRelease: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  nextPublicSentryTracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  sentryDebug: process.env.SENTRY_DEBUG,
  sentryDsn: process.env.SENTRY_DSN,
  sentryEnableConsoleLogs: process.env.SENTRY_ENABLE_CONSOLE_LOGS,
  sentryEnableLogs: process.env.SENTRY_ENABLE_LOGS,
  sentryEnvironment: process.env.SENTRY_ENVIRONMENT,
  sentryMinLogLevel: process.env.SENTRY_MIN_LOG_LEVEL,
  sentryProfileLifecycle: process.env.SENTRY_PROFILE_LIFECYCLE,
  sentryProfileSessionSampleRate: process.env.SENTRY_PROFILE_SESSION_SAMPLE_RATE,
  sentryRelease: process.env.SENTRY_RELEASE,
  sentryTracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
} as const;

type MonitoringPrimitive = string | number | boolean | null | undefined;
export type MonitoringAttributes = Record<string, MonitoringPrimitive>;
type MonitoringLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
type SentryLogThreshold = MonitoringLevel | "off";
type CaptureLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseProfileLifecycle(
  value: string | undefined,
  fallback: "manual" | "trace",
): "manual" | "trace" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "manual") return "manual";
  if (normalized === "trace") return "trace";
  return fallback;
}

function parseLogThreshold(value: string | undefined, fallback: SentryLogThreshold): SentryLogThreshold {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "off") return "off";
  if (normalized === "trace") return "trace";
  if (normalized === "debug") return "debug";
  if (normalized === "info") return "info";
  if (normalized === "warn" || normalized === "warning") return "warn";
  if (normalized === "error") return "error";
  if (normalized === "fatal") return "fatal";
  return fallback;
}

function sanitizeSensitiveText(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value);
}

function normalizeScalar(value: MonitoringPrimitive): string | number | boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const normalized = sanitizeSensitiveText(value).trim();
    return normalized ? normalized.slice(0, 200) : undefined;
  }
  return value;
}

function normalizeTagValue(value: MonitoringPrimitive): string | undefined {
  const normalized = normalizeScalar(value);
  if (normalized == null) return undefined;
  return String(normalized);
}

function getMonitoringEnvironment(runtime: "client" | "server" | "edge"): string {
  return (
    (runtime === "client"
      ? ENV.nextPublicSentryEnvironment || ENV.sentryEnvironment
      : ENV.sentryEnvironment || ENV.nextPublicSentryEnvironment) ||
    process.env.NODE_ENV ||
    "development"
  );
}

function getMonitoringRelease(runtime: "client" | "server" | "edge"): string | undefined {
  const value =
    runtime === "client"
      ? ENV.nextPublicSentryRelease || ENV.sentryRelease
      : ENV.sentryRelease || ENV.nextPublicSentryRelease;

  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function scrubUnknown(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return sanitizeSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubUnknown(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
      childKey,
      scrubUnknown(childValue, childKey),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

function setTags(tags: MonitoringAttributes): void {
  for (const [key, value] of Object.entries(tags)) {
    const normalized = normalizeTagValue(value);
    if (normalized) {
      Sentry.setTag(key, normalized);
    }
  }
}

function isConsoleLoggingEnabled(runtime: "client" | "server" | "edge"): boolean {
  return runtime === "client"
    ? parseBoolean(
        ENV.nextPublicSentryEnableConsoleLogs || ENV.sentryEnableConsoleLogs,
        DEFAULT_CONSOLE_LOG_CAPTURE_ENABLED,
      )
    : parseBoolean(
        ENV.sentryEnableConsoleLogs || ENV.nextPublicSentryEnableConsoleLogs,
        DEFAULT_CONSOLE_LOG_CAPTURE_ENABLED,
      );
}

function normalizeMonitoringLevel(value: string | undefined): MonitoringLevel {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "trace") return "trace";
  if (normalized === "debug") return "debug";
  if (normalized === "warn" || normalized === "warning") return "warn";
  if (normalized === "error") return "error";
  if (normalized === "fatal") return "fatal";
  return "info";
}

function getSentryLogThreshold(runtime: "client" | "server" | "edge"): SentryLogThreshold {
  return runtime === "client"
    ? parseLogThreshold(ENV.nextPublicSentryMinLogLevel || ENV.sentryMinLogLevel, DEFAULT_SENTRY_MIN_LOG_LEVEL)
    : parseLogThreshold(ENV.sentryMinLogLevel || ENV.nextPublicSentryMinLogLevel, DEFAULT_SENTRY_MIN_LOG_LEVEL);
}

function shouldDropSentryLog(runtime: "client" | "server" | "edge", level: MonitoringLevel, message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return true;
  const threshold = getSentryLogThreshold(runtime);
  if (threshold === "off") return true;
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[threshold]) {
    return true;
  }
  return LOW_VALUE_LOG_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildBeforeSendLog(runtime: "client" | "server" | "edge") {
  return (log: Log): Log | null => {
    const message = sanitizeSensitiveText(String(log.message || "").trim());
    const level = normalizeMonitoringLevel(String(log.level || "info"));
    if (shouldDropSentryLog(runtime, level, message)) {
      return null;
    }

    return {
      ...log,
      message,
      attributes: {
        ...(scrubUnknown(log.attributes || {}) as Record<string, unknown>),
        app_name: APP_NAME,
        monitoring_vendor: MONITORING_VENDOR,
        sentry_runtime: runtime,
      },
    };
  };
}

function buildBeforeSendEvent() {
  return (event: ErrorEvent, _hint: EventHint): ErrorEvent | null => {
    void _hint;
    const scrubbed = scrubUnknown(event) as ErrorEvent;
    return scrubbed;
  };
}

function buildInitOptions(runtime: "client" | "server" | "edge", dsn: string | undefined) {
  const release = getMonitoringRelease(runtime);

  return {
    dsn,
    enabled: Boolean(dsn),
    environment: getMonitoringEnvironment(runtime),
    release: getMonitoringRelease(runtime),
    sendDefaultPii: DEFAULT_SEND_DEFAULT_PII,
    tracesSampleRate:
      runtime === "client"
        ? parseNumber(
            ENV.nextPublicSentryTracesSampleRate || ENV.sentryTracesSampleRate,
            DEFAULT_TRACES_SAMPLE_RATE,
          )
        : parseNumber(
            ENV.sentryTracesSampleRate || ENV.nextPublicSentryTracesSampleRate,
            DEFAULT_TRACES_SAMPLE_RATE,
          ),
    enableLogs:
      runtime === "client"
        ? parseBoolean(ENV.nextPublicSentryEnableLogs || ENV.sentryEnableLogs, DEFAULT_LOGS_ENABLED)
        : parseBoolean(ENV.sentryEnableLogs || ENV.nextPublicSentryEnableLogs, DEFAULT_LOGS_ENABLED),
    profileSessionSampleRate:
      runtime === "client"
        ? parseNumber(
            ENV.nextPublicSentryProfileSessionSampleRate || ENV.sentryProfileSessionSampleRate,
            DEFAULT_PROFILE_SESSION_SAMPLE_RATE,
          )
        : parseNumber(
            ENV.sentryProfileSessionSampleRate || ENV.nextPublicSentryProfileSessionSampleRate,
            DEFAULT_PROFILE_SESSION_SAMPLE_RATE,
          ),
    profileLifecycle:
      runtime === "client"
        ? parseProfileLifecycle(
            ENV.nextPublicSentryProfileLifecycle || ENV.sentryProfileLifecycle,
            DEFAULT_PROFILE_LIFECYCLE,
          )
        : parseProfileLifecycle(
            ENV.sentryProfileLifecycle || ENV.nextPublicSentryProfileLifecycle,
            DEFAULT_PROFILE_LIFECYCLE,
          ),
    debug:
      runtime === "client"
        ? parseBoolean(ENV.nextPublicSentryDebug || ENV.sentryDebug, false)
        : parseBoolean(ENV.sentryDebug || ENV.nextPublicSentryDebug, false),
    beforeSend: buildBeforeSendEvent(),
    beforeSendLog: buildBeforeSendLog(runtime),
    initialScope: {
      tags: {
        "escal8.app": APP_NAME,
        "escal8.monitoring": MONITORING_VENDOR,
        "escal8.runtime": runtime,
        ...(release ? { "escal8.release": release } : {}),
      },
    },
  };
}

export function getClientSentryConfig() {
  const tracePropagationTargets: Array<string | RegExp> = [/^\//, /^https?:\/\/localhost(?::\d+)?\//];
  if (ENV.nextPublicAppUrl) {
    tracePropagationTargets.push(ENV.nextPublicAppUrl);
  }

  return {
    ...buildInitOptions("client", ENV.nextPublicSentryDsn),
    tracePropagationTargets,
  };
}

export function getServerSentryConfig() {
  return buildInitOptions("server", ENV.sentryDsn || ENV.nextPublicSentryDsn);
}

export function getEdgeSentryConfig() {
  return buildInitOptions("edge", ENV.sentryDsn || ENV.nextPublicSentryDsn);
}

export function getClientSentryIntegrations() {
  const browserSdk = Sentry as typeof Sentry & {
    browserProfilingIntegration?: () => Integration;
  };
  const integrations: Integration[] = [Sentry.browserTracingIntegration()];

  if (typeof browserSdk.browserProfilingIntegration === "function") {
    integrations.push(browserSdk.browserProfilingIntegration());
  }

  if (isConsoleLoggingEnabled("client")) {
    integrations.push(Sentry.consoleLoggingIntegration({ levels: ["error"] }));
  }

  return integrations;
}

export function getServerSentryIntegrations() {
  const integrations: Integration[] = [];

  if (isConsoleLoggingEnabled("server")) {
    integrations.push(Sentry.consoleLoggingIntegration({ levels: ["error"] }));
  }

  return integrations;
}

export function getEdgeSentryIntegrations() {
  const integrations: Integration[] = [];

  if (isConsoleLoggingEnabled("edge")) {
    integrations.push(Sentry.consoleLoggingIntegration({ levels: ["error"] }));
  }

  return integrations;
}

export function buildMonitoringAttributes(
  attributes: MonitoringAttributes = {},
): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {
    app_name: APP_NAME,
    monitoring_vendor: MONITORING_VENDOR,
  };

  for (const [key, value] of Object.entries(attributes)) {
    const scalar = normalizeScalar(value);
    if (scalar != null) {
      normalized[key] = scalar;
    }
  }

  return normalized;
}

export function recordSentryLog(
  level: MonitoringLevel,
  message: string,
  attributes: MonitoringAttributes = {},
): void {
  const sanitizedMessage = sanitizeSensitiveText(message);
  const payload = buildMonitoringAttributes(attributes);

  recordGrafanaLog(level, sanitizedMessage, payload, {
    source: "app",
  });

  if (level === "trace") {
    Sentry.logger.trace(sanitizedMessage, payload);
    return;
  }
  if (level === "debug") {
    Sentry.logger.debug(sanitizedMessage, payload);
    return;
  }
  if (level === "info") {
    Sentry.logger.info(sanitizedMessage, payload);
    return;
  }
  if (level === "warn") {
    Sentry.logger.warn(sanitizedMessage, payload);
    return;
  }
  if (level === "fatal") {
    Sentry.logger.fatal(sanitizedMessage, payload);
    return;
  }
  Sentry.logger.error(sanitizedMessage, payload);
}

export function recordSentryMetric(
  type: "count" | "gauge" | "distribution",
  name: string,
  value: number,
  attributes: MonitoringAttributes = {},
  unit?: string,
): void {
  const options = {
    attributes: buildMonitoringAttributes(attributes),
    ...(unit ? { unit } : {}),
  };

  if (type === "count") {
    Sentry.metrics.count(name, value, options);
    return;
  }
  if (type === "gauge") {
    Sentry.metrics.gauge(name, value, options);
    return;
  }
  Sentry.metrics.distribution(name, value, options);
}

export function captureSentryException(
  error: unknown,
  options: {
    action?: string;
    area?: string;
    contexts?: Record<string, Record<string, unknown>>;
    level?: CaptureLevel;
    tags?: MonitoringAttributes;
  } = {},
): void {
  recordGrafanaLog(
    "error",
    sanitizeSensitiveText(error instanceof Error ? error.message : String(error)),
    buildMonitoringAttributes({
      action: options.action,
      area: options.area,
      log_source: "exception",
      ...(options.tags || {}),
    }),
    {
      source: "exception",
    },
  );

  Sentry.withScope((scope) => {
    scope.setTag("escal8.app", APP_NAME);
    scope.setTag("escal8.monitoring", MONITORING_VENDOR);
    if (options.area) {
      scope.setTag("escal8.area", options.area);
    }
    if (options.action) {
      scope.setTag("escal8.action", options.action);
    }
    if (options.level) {
      scope.setLevel(options.level);
    }
    for (const [key, value] of Object.entries(options.tags || {})) {
      const normalized = normalizeTagValue(value);
      if (normalized) {
        scope.setTag(key, normalized);
      }
    }
    for (const [key, value] of Object.entries(options.contexts || {})) {
      scope.setContext(key, value);
    }
    Sentry.captureException(error);
  });
}

export function shouldUseExternalOpenTelemetry(): boolean {
  return Boolean((process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim());
}

export function getOpenTelemetryServiceName(): string {
  return (process.env.OTEL_SERVICE_NAME || APP_NAME).trim() || APP_NAME;
}

export function updateSentryScope(options: {
  businessId?: string | null;
  route?: string | null;
  step?: string | null;
  surface?: string | null;
  user?:
    | {
        email?: string | null;
        id?: string | null;
        username?: string | null;
      }
    | null;
}): void {
  setTags({
    "escal8.app": APP_NAME,
    "escal8.monitoring": MONITORING_VENDOR,
    "escal8.business_id": options.businessId,
    "escal8.route": options.route,
    "escal8.step": options.step,
    "escal8.surface": options.surface,
  });

  if (!options.user) {
    Sentry.setUser(null);
    return;
  }

  const id = normalizeTagValue(options.user.id);
  const email = normalizeTagValue(options.user.email);
  const username = normalizeTagValue(options.user.username);

  if (!id && !email && !username) {
    Sentry.setUser(null);
    return;
  }

  Sentry.setUser({
    email,
    id,
    username,
  });
}

export function getMonitoringDomainFromPath(path: string): string {
  const normalized = String(path || "").trim().toLowerCase();
  if (!normalized) return "app";
  if (normalized.includes("auth")) return "auth";
  if (normalized.includes("upload")) return "upload";
  if (normalized.includes("whatsapp")) return "whatsapp";
  if (normalized.includes("rag")) return "rag";
  if (normalized.includes("ticket")) return "ticket";
  if (normalized.includes("booking")) return "booking";
  if (normalized.includes("customer")) return "customer";
  if (normalized.includes("message")) return "message";
  if (normalized.includes("user")) return "user";
  if (normalized.includes("realtime") || normalized.includes("event")) return "realtime";
  return normalized.split(/[./]/)[0] || "app";
}
