"use client";

import { getFirebaseAuth } from "@/lib/firebaseClient";
import {
  isClientErrorReported,
  markClientErrorReported,
  recordClientBusinessEvent,
  shouldCaptureUnexpectedClientError,
} from "@/lib/client-business-monitoring";

type MonitoringPrimitive = string | number | boolean | null | undefined;
type MonitoringAttributes = Record<string, MonitoringPrimitive>;
type ClientFailureReport = {
  action: string;
  area: string;
  attributes?: MonitoringAttributes;
  captureInSentry: boolean;
  event: string;
  level: "warn" | "error";
  outcome: "handled_failure" | "unexpected_failure";
  route?: string | null;
};

type ClientAuthOperationOptions = {
  action: string;
  area?: string;
  attributes?: MonitoringAttributes;
  freshToken?: boolean;
  missingConfigEvent?: string;
  missingSessionEvent?: string;
  onFailure?: (error: unknown, report: ClientFailureReport) => void;
  route?: string | null;
  tokenFailureEvent?: string;
};

type AuthenticatedFetchOptions = ClientAuthOperationOptions & {
  requestFailureEvent?: string;
};

function resolveRoute(route?: string | null): string | null {
  if (typeof route === "string" && route.trim()) return route;
  if (typeof window !== "undefined" && window.location?.pathname) return window.location.pathname;
  return null;
}

function assignErrorCode(error: Error, code: string) {
  (error as Error & { code?: string }).code = code;
  return error;
}

function reportClientFailure(
  error: unknown,
  input: ClientFailureReport & { onFailure?: (error: unknown, report: ClientFailureReport) => void },
) {
  if (isClientErrorReported(error)) return;

  if (input.onFailure) {
    input.onFailure(error, input);
    markClientErrorReported(error);
    return;
  }

  recordClientBusinessEvent({
    action: input.action,
    area: input.area || "app",
    attributes: input.attributes,
    captureInSentry: input.captureInSentry,
    error,
    event: input.event,
    level: input.level,
    outcome: input.outcome,
    route: resolveRoute(input.route),
  });

  markClientErrorReported(error);
}

export async function getFirebaseIdTokenOrThrow(options: ClientAuthOperationOptions): Promise<string> {
  const area = options.area || "auth";
  const route = resolveRoute(options.route);
  const auth = getFirebaseAuth();

  if (!auth) {
    const error = assignErrorCode(
      new Error("Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars."),
      "app/firebase-auth-unconfigured",
    );
    reportClientFailure(error, {
      action: options.action,
      area,
      attributes: options.attributes,
      captureInSentry: true,
      event: options.missingConfigEvent || "auth.firebase_config_missing",
      level: "error",
      outcome: "unexpected_failure",
      route,
      onFailure: options.onFailure,
    });
    throw error;
  }

  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    const error = assignErrorCode(new Error("Authentication session not available."), "auth/session-missing");
    reportClientFailure(error, {
      action: options.action,
      area,
      attributes: options.attributes,
      captureInSentry: false,
      event: options.missingSessionEvent || "auth.session_missing",
      level: "warn",
      outcome: "handled_failure",
      route,
      onFailure: options.onFailure,
    });
    throw error;
  }

  try {
    // Allowed raw token access: this helper centralizes client auth failure reporting.
    const token = await currentUser.getIdToken(Boolean(options.freshToken));
    if (!token) {
      const error = assignErrorCode(new Error("Authentication session not available."), "auth/session-missing");
      reportClientFailure(error, {
        action: options.action,
        area,
        attributes: options.attributes,
        captureInSentry: false,
        event: options.missingSessionEvent || "auth.session_missing",
        level: "warn",
        outcome: "handled_failure",
        route,
        onFailure: options.onFailure,
      });
      throw error;
    }
    return token;
  } catch (error) {
    if (!isClientErrorReported(error)) {
      const captureInSentry = shouldCaptureUnexpectedClientError(error);
      reportClientFailure(error, {
        action: options.action,
        area,
        attributes: options.attributes,
        captureInSentry,
        event: options.tokenFailureEvent || "auth.token_fetch_failed",
        level: captureInSentry ? "error" : "warn",
        outcome: captureInSentry ? "unexpected_failure" : "handled_failure",
        route,
        onFailure: options.onFailure,
      });
    }
    throw error;
  }
}

export async function fetchWithFirebaseAuth(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: AuthenticatedFetchOptions,
): Promise<Response> {
  const route = resolveRoute(options.route);
  const token = await getFirebaseIdTokenOrThrow(options);

  try {
    const headers = new Headers(init?.headers);
    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }

    return await fetch(input, {
      ...init,
      headers,
    });
  } catch (error) {
    if (!isClientErrorReported(error)) {
      reportClientFailure(error, {
        action: options.action,
        area: options.area || "app",
        attributes: options.attributes,
        captureInSentry: true,
        event: options.requestFailureEvent || "app.request_failed",
        level: "error",
        outcome: "unexpected_failure",
        route,
        onFailure: options.onFailure,
      });
    }
    throw error;
  }
}
