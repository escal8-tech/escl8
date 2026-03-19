import * as Sentry from "@sentry/nextjs";

import { installClientConsoleBridge } from "@/lib/grafana-monitoring";
import { getClientSentryConfig, getClientSentryIntegrations } from "@/lib/sentry-monitoring";

// SENTRY-OBSERVABILITY: browser SDK bootstrap for errors, traces, metrics, and logs.

installClientConsoleBridge();

const clientSentryConfig: Parameters<typeof Sentry.init>[0] = {
  ...getClientSentryConfig(),
  integrations: getClientSentryIntegrations(),
};

Sentry.init(clientSentryConfig);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
