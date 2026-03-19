import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    return;
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// SENTRY-OBSERVABILITY: nested request error capture for app router handlers.
export const onRequestError = Sentry.captureRequestError;
