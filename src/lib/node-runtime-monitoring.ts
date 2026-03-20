import * as Sentry from "@sentry/nextjs";

import { installServerConsoleBridge } from "@/lib/grafana-monitoring";
import {
  getOpenTelemetryServiceName,
  getServerSentryConfig,
  getServerSentryIntegrations,
  shouldUseExternalOpenTelemetry,
} from "@/lib/sentry-monitoring";

const NODE_RUNTIME_MONITORING_FLAG = "__escal8NodeRuntimeMonitoringInstalled";

function isStandaloneScriptRuntime(): boolean {
  const entrypoint = process.argv[1] || "";
  return entrypoint.includes("/scripts/") || entrypoint.includes("\\scripts\\");
}

async function tryRegisterExternalOpenTelemetry(): Promise<void> {
  try {
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({
      serviceName: getOpenTelemetryServiceName(),
    });
  } catch (error) {
    console.warn(
      `[monitoring] External OpenTelemetry bootstrap skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function registerNodeRuntimeMonitoring(): void {
  const globalState = globalThis as typeof globalThis & Record<string, unknown>;
  if (globalState[NODE_RUNTIME_MONITORING_FLAG]) return;
  globalState[NODE_RUNTIME_MONITORING_FLAG] = true;

  if (shouldUseExternalOpenTelemetry() && !isStandaloneScriptRuntime()) {
    void tryRegisterExternalOpenTelemetry();
  }

  installServerConsoleBridge();

  const serverSentryConfig: Parameters<typeof Sentry.init>[0] = {
    ...getServerSentryConfig(),
    integrations: getServerSentryIntegrations(),
    skipOpenTelemetrySetup: shouldUseExternalOpenTelemetry(),
  };

  Sentry.init(serverSentryConfig);
}
