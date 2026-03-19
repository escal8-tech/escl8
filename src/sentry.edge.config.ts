import * as Sentry from "@sentry/nextjs";

import { getEdgeSentryConfig, getEdgeSentryIntegrations } from "@/lib/sentry-monitoring";

// SENTRY-OBSERVABILITY: edge runtime SDK bootstrap.

const edgeSentryConfig: Parameters<typeof Sentry.init>[0] = {
  ...getEdgeSentryConfig(),
  integrations: getEdgeSentryIntegrations(),
};

Sentry.init(edgeSentryConfig);
