import * as Sentry from "@sentry/nextjs";
import { registerOTel } from "@vercel/otel";

import { installServerConsoleBridge } from "@/lib/grafana-monitoring";
import {
  getOpenTelemetryServiceName,
  getServerSentryConfig,
  getServerSentryIntegrations,
  shouldUseExternalOpenTelemetry,
} from "@/lib/sentry-monitoring";

const NODE_RUNTIME_MONITORING_FLAG = "__escal8NodeRuntimeMonitoringInstalled";

export function registerNodeRuntimeMonitoring(): void {
  const globalState = globalThis as typeof globalThis & Record<string, unknown>;
  if (globalState[NODE_RUNTIME_MONITORING_FLAG]) return;
  globalState[NODE_RUNTIME_MONITORING_FLAG] = true;

  if (shouldUseExternalOpenTelemetry()) {
    registerOTel({
      serviceName: getOpenTelemetryServiceName(),
    });
  }

  installServerConsoleBridge();

  const serverSentryConfig: Parameters<typeof Sentry.init>[0] = {
    ...getServerSentryConfig(),
    integrations: getServerSentryIntegrations(),
    skipOpenTelemetrySetup: shouldUseExternalOpenTelemetry(),
  };

  Sentry.init(serverSentryConfig);
}
