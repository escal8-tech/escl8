const APP_NAME = "escl8-agent-dashboard";
const CLIENT_LOG_ENDPOINT = "/api/observability/logs";
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BROWSER_LOGS_ENABLED = false;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_SERVER_CONSOLE_MIN_LEVEL: GrafanaLogLevel = "warn";
const SERVER_PATCH_FLAG = "__escal8GrafanaServerConsoleBridgeInstalled";
const CLIENT_PATCH_FLAG = "__escal8GrafanaClientConsoleBridgeInstalled";
const LOG_LEVEL_PRIORITY: Record<GrafanaLogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};
const LOW_VALUE_CONSOLE_PATTERNS = [/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//, /^(?:○|✓)\s/];
const SENSITIVE_ATTRIBUTE_KEY_PATTERN =
  /(authorization|cookie|set-cookie|token|secret|password|api[-_]?key|session|csrf)/i;
const SENSITIVE_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\bBasic\s+[A-Za-z0-9+/=]+\b/gi,
];

type MonitoringPrimitive = string | number | boolean | null | undefined;
type MonitoringAttributes = Record<string, MonitoringPrimitive>;
export type GrafanaLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
type GrafanaRuntime = "client" | "server";
type ConsoleMethodName = "debug" | "info" | "log" | "warn" | "error";

type GrafanaLogEntry = {
  attributes?: MonitoringAttributes;
  level: GrafanaLogLevel;
  message: string;
  runtime: GrafanaRuntime;
  source?: string;
};

type BrowserLogEnvelope = {
  attributes?: MonitoringAttributes;
  level: GrafanaLogLevel;
  message: string;
  source?: string;
};

type ServerQueueEntry = {
  labels: Record<string, string>;
  line: string;
  timestamp: string;
};

let serverQueue: ServerQueueEntry[] = [];
let serverFlushTimer: ReturnType<typeof setTimeout> | null = null;
const browserQueue: BrowserLogEnvelope[] = [];
let browserFlushTimer: ReturnType<typeof setTimeout> | null = null;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function sanitizeSensitiveText(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value);
}

function normalizeScalar(key: string, value: MonitoringPrimitive): string | number | boolean | undefined {
  if (value == null) return undefined;
  if (SENSITIVE_ATTRIBUTE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    const normalized = sanitizeSensitiveText(value).trim();
    return normalized ? normalized.slice(0, 1000) : undefined;
  }
  return value;
}

function normalizeAttributes(
  attributes: MonitoringAttributes = {},
): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes)) {
    const scalar = normalizeScalar(key, value);
    if (scalar != null) {
      normalized[key] = scalar;
    }
  }

  return normalized;
}

function isServerRuntime(): boolean {
  return typeof window === "undefined";
}

function getDeploymentEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT ||
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
    process.env.NODE_ENV ||
    "development"
  );
}

function getServiceName(): string {
  return (process.env.OTEL_SERVICE_NAME || APP_NAME).trim() || APP_NAME;
}

function getReleaseName(): string {
  return (
    process.env.SENTRY_RELEASE ||
    process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
    process.env.APP_RELEASE ||
    process.env.GITHUB_SHA ||
    ""
  ).trim();
}

function getDeploymentMetadata(): Record<string, string | number | boolean> {
  return normalizeAttributes({
    container_revision:
      process.env.CONTAINER_APP_REVISION ||
      process.env.CONTAINER_APP_REVISION_NAME ||
      process.env.CONTAINER_APP_REPLICA_NAME,
    hostname: process.env.HOSTNAME,
    release: getReleaseName(),
  });
}

function getGrafanaLogsEndpoint(): string {
  return (process.env.GRAFANA_LOGS_ENDPOINT || process.env.GRAFANA_LOKI_ENDPOINT || "").trim();
}

function getGrafanaLogsAuthHeader(): string {
  const basicAuth = (process.env.GRAFANA_LOGS_BASIC_AUTH || "").trim();
  if (basicAuth) {
    return `Basic ${basicAuth}`;
  }

  const user = (process.env.GRAFANA_LOGS_USER || "").trim();
  const apiKey = (process.env.GRAFANA_LOGS_API_KEY || "").trim();
  if (!user || !apiKey || !isServerRuntime()) {
    return "";
  }

  return `Basic ${Buffer.from(`${user}:${apiKey}`, "utf8").toString("base64")}`;
}

function isGrafanaServerLoggingEnabled(): boolean {
  return Boolean(getGrafanaLogsEndpoint() && getGrafanaLogsAuthHeader());
}

export function isGrafanaBrowserLoggingEnabled(): boolean {
  return parseBoolean(
    process.env.NEXT_PUBLIC_GRAFANA_BROWSER_LOGS_ENABLED,
    DEFAULT_BROWSER_LOGS_ENABLED,
  );
}

function shouldCaptureServerConsole(level: GrafanaLogLevel, message: string): boolean {
  const normalized = String(message || "").trim();
  if (!normalized) return false;
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[DEFAULT_SERVER_CONSOLE_MIN_LEVEL]) {
    return false;
  }
  return !LOW_VALUE_CONSOLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getNanosecondTimestamp(): string {
  return `${Date.now()}000000`;
}

function serializeValue(value: unknown): string {
  if (value instanceof Error) {
    return sanitizeSensitiveText(
      JSON.stringify({
        message: value.message,
        name: value.name,
        stack: value.stack,
      }),
    );
  }

  if (typeof value === "string") return sanitizeSensitiveText(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value == null) return "";

  try {
    return sanitizeSensitiveText(JSON.stringify(value));
  } catch {
    return sanitizeSensitiveText(String(value));
  }
}

function serializeConsoleArgs(args: unknown[]): string {
  return args.map(serializeValue).filter(Boolean).join(" ").slice(0, 4000);
}

function buildServerLabels(entry: GrafanaLogEntry): Record<string, string> {
  return {
    app: APP_NAME,
    environment: getDeploymentEnvironment(),
    level: entry.level,
    runtime: entry.runtime,
    service_name: getServiceName(),
    source: entry.source || "app",
  };
}

function buildLogLine(entry: GrafanaLogEntry): string {
  return JSON.stringify({
    app_name: APP_NAME,
    attributes: normalizeAttributes(entry.attributes),
    ...getDeploymentMetadata(),
    environment: getDeploymentEnvironment(),
    level: entry.level,
    message: sanitizeSensitiveText(entry.message).slice(0, 4000),
    runtime: entry.runtime,
    service_name: getServiceName(),
    source: entry.source || "app",
    timestamp: new Date().toISOString(),
  });
}

async function flushServerQueue(): Promise<void> {
  if (!isServerRuntime()) return;
  if (!isGrafanaServerLoggingEnabled()) {
    serverQueue = [];
    return;
  }
  if (!serverQueue.length) return;

  if (serverFlushTimer) {
    clearTimeout(serverFlushTimer);
    serverFlushTimer = null;
  }

  const batch = serverQueue.splice(0, serverQueue.length);
  const streams = new Map<string, { stream: Record<string, string>; values: string[][] }>();

  for (const entry of batch) {
    const key = JSON.stringify(entry.labels);
    const existing = streams.get(key);
    if (existing) {
      existing.values.push([entry.timestamp, entry.line]);
      continue;
    }

    streams.set(key, {
      stream: entry.labels,
      values: [[entry.timestamp, entry.line]],
    });
  }

  try {
    await fetch(getGrafanaLogsEndpoint(), {
      method: "POST",
      headers: {
        authorization: getGrafanaLogsAuthHeader(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        streams: Array.from(streams.values()),
      }),
    });
  } catch {
    // Drop failed batches to avoid blocking the app on observability transport.
  }
}

function scheduleServerFlush(): void {
  if (serverFlushTimer) return;
  serverFlushTimer = setTimeout(() => {
    serverFlushTimer = null;
    void flushServerQueue();
  }, DEFAULT_FLUSH_INTERVAL_MS);
}

function enqueueServerLog(entry: GrafanaLogEntry): void {
  if (!isGrafanaServerLoggingEnabled()) return;

  serverQueue.push({
    labels: buildServerLabels(entry),
    line: buildLogLine(entry),
    timestamp: getNanosecondTimestamp(),
  });

  if (serverQueue.length >= DEFAULT_BATCH_SIZE) {
    void flushServerQueue();
    return;
  }

  scheduleServerFlush();
}

async function flushBrowserQueue(useBeacon = false): Promise<void> {
  if (!browserQueue.length) return;

  if (browserFlushTimer) {
    clearTimeout(browserFlushTimer);
    browserFlushTimer = null;
  }

  const batch = browserQueue.splice(0, browserQueue.length);
  const body = JSON.stringify({ logs: batch });

  if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(CLIENT_LOG_ENDPOINT, blob);
    return;
  }

  try {
    await fetch(CLIENT_LOG_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body,
      keepalive: true,
    });
  } catch {
    // Ignore client forwarding failures. The app should not notice.
  }
}

function scheduleBrowserFlush(): void {
  if (browserFlushTimer) return;
  browserFlushTimer = setTimeout(() => {
    browserFlushTimer = null;
    void flushBrowserQueue();
  }, DEFAULT_FLUSH_INTERVAL_MS);
}

function enqueueBrowserLog(entry: BrowserLogEnvelope, force = false): void {
  if (!force && !isGrafanaBrowserLoggingEnabled()) return;

  browserQueue.push(entry);

  if (browserQueue.length >= DEFAULT_BATCH_SIZE) {
    void flushBrowserQueue();
    return;
  }

  scheduleBrowserFlush();
}

export function recordGrafanaLog(
  level: GrafanaLogLevel,
  message: string,
  attributes: MonitoringAttributes = {},
  options: {
    forceClientDelivery?: boolean;
    runtime?: GrafanaRuntime;
    source?: string;
  } = {},
): void {
  const runtime = options.runtime || (isServerRuntime() ? "server" : "client");
  const entry: GrafanaLogEntry = {
    attributes,
    level,
    message: String(message || "").trim() || "empty_log_message",
    runtime,
    source: options.source,
  };

  if (isServerRuntime()) {
    enqueueServerLog(entry);
    return;
  }

  enqueueBrowserLog(
    {
      attributes,
      level,
      message: entry.message,
      source: options.source,
    },
    Boolean(options.forceClientDelivery),
  );
}

export function installServerConsoleBridge(): void {
  if (!isServerRuntime()) return;
  if (!isGrafanaServerLoggingEnabled()) return;

  const globalState = globalThis as typeof globalThis & Record<string, unknown>;
  if (globalState[SERVER_PATCH_FLAG]) return;
  globalState[SERVER_PATCH_FLAG] = true;

  const methods: Array<[ConsoleMethodName, GrafanaLogLevel]> = [
    ["debug", "debug"],
    ["info", "info"],
    ["log", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ];

  for (const [method, level] of methods) {
    const original = (console[method] as (...args: unknown[]) => void).bind(console);
    console[method] = ((...args: unknown[]) => {
      original(...args);
      const message = serializeConsoleArgs(args);
      if (!shouldCaptureServerConsole(level, message)) {
        return;
      }
      recordGrafanaLog(
        level,
        message,
        {
          log_source: "console",
          console_method: method,
        },
        {
          runtime: "server",
          source: "console",
        },
      );
    }) as Console[typeof method];
  }
}

export function installClientConsoleBridge(): void {
  if (isServerRuntime()) return;
  if (!isGrafanaBrowserLoggingEnabled()) return;

  const globalState = globalThis as typeof globalThis & Record<string, unknown>;
  if (globalState[CLIENT_PATCH_FLAG]) return;
  globalState[CLIENT_PATCH_FLAG] = true;

  const methods: Array<[ConsoleMethodName, GrafanaLogLevel]> = [
    ["debug", "debug"],
    ["info", "info"],
    ["log", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ];

  for (const [method, level] of methods) {
    const original = (console[method] as (...args: unknown[]) => void).bind(console);
    console[method] = ((...args: unknown[]) => {
      original(...args);
      recordGrafanaLog(
        level,
        serializeConsoleArgs(args),
        {
          log_source: "console",
          console_method: method,
          route: window.location.pathname,
        },
        {
          runtime: "client",
          source: "console",
        },
      );
    }) as Console[typeof method];
  }

  window.addEventListener("error", (event) => {
    recordGrafanaLog(
      "error",
      event.message || "window.error",
      {
        colno: event.colno,
        filename: event.filename,
        lineno: event.lineno,
        route: window.location.pathname,
      },
      {
        runtime: "client",
        source: "window.error",
      },
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    recordGrafanaLog(
      "error",
      serializeValue(event.reason) || "window.unhandledrejection",
      {
        route: window.location.pathname,
      },
      {
        runtime: "client",
        source: "window.unhandledrejection",
      },
    );
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushBrowserQueue(true);
    }
  });
}
