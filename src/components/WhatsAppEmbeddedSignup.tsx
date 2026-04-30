/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { fetchWithFirebaseAuth } from "@/lib/client-auth-ops";
import { recordClientBusinessEvent } from "@/lib/client-business-monitoring";
import { useToast, type ToastType } from "@/components/ToastProvider";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

type EmbeddedSignupSuccessEvent =
  | "FINISH"
  | "FINISH_ONLY_WABA"
  | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
  | "FINISH_OBO_MIGRATION"
  | "FINISH_GRANT_ONLY_API_ACCESS";

type EmbeddedSignupSuccessData = {
  phone_number_id?: string;
  waba_id?: string;
  business_id?: string;
  waba_ids?: string[];
  ad_account_ids?: string[];
  page_ids?: string[];
  dataset_ids?: string[];
  catalog_ids?: string[];
  instagram_account_ids?: string[];
};

type SessionEvent =
  | {
      type: "WA_EMBEDDED_SIGNUP";
      event: EmbeddedSignupSuccessEvent;
      data: EmbeddedSignupSuccessData;
    }
  | { type: "WA_EMBEDDED_SIGNUP"; event: "CANCEL"; data: { current_step?: string } }
  | { type: "WA_EMBEDDED_SIGNUP"; event: "ERROR"; data: { error_message?: string; error_code?: string; session_id?: string; timestamp?: number } };

const SUCCESSFUL_EMBEDDED_SIGNUP_EVENTS = new Set<EmbeddedSignupSuccessEvent>([
  "FINISH",
  "FINISH_ONLY_WABA",
  "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  "FINISH_OBO_MIGRATION",
  "FINISH_GRANT_ONLY_API_ACCESS",
]);

function isSuccessfulEmbeddedSignupEvent(event: string): event is EmbeddedSignupSuccessEvent {
  return SUCCESSFUL_EMBEDDED_SIGNUP_EVENTS.has(event as EmbeddedSignupSuccessEvent);
}

function isSuccessfulEmbeddedSignupMessage(
  event: SessionEvent,
): event is Extract<SessionEvent, { event: EmbeddedSignupSuccessEvent }> {
  return isSuccessfulEmbeddedSignupEvent(event.event);
}

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

const FB_APP_ID = process.env.NEXT_PUBLIC_FB_APP_ID || "3048147058702810";
const FB_EMBEDDED_SIGNUP_CONFIG_ID = process.env.NEXT_PUBLIC_FB_EMBEDDED_SIGNUP_CONFIG_ID || "2342508846172693";

type WhatsAppEmbeddedSignupButtonProps = {
  email?: string;
  onConnected?: () => void;
  label?: string;
  syncedLabel?: string;
  connected?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  className?: string;
  style?: React.CSSProperties;
};

type SyncResponse =
  | { ok: true; stored: boolean; setupComplete: boolean; message?: string }
  | { ok: false; error: string; code?: string };

export function WhatsAppEmbeddedSignupButton({
  email,
  onConnected,
  label,
  syncedLabel,
  connected: connectedProp,
  disabled = false,
  disabledReason = null,
  className,
  style,
}: WhatsAppEmbeddedSignupButtonProps = {}) {
  const pathname = usePathname();
  const toast = useToast();
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  // Store whichever arrives first and combine later
  const toastIdRef = useRef<string | null>(null);
  const toastResetTimerRef = useRef<number | null>(null);
  const codeRef = useRef<string | null>(null);
  const idsRef = useRef<{
    phoneNumberId: string;
    wabaId: string | null;
    wabaIds: string[];
    metaBusinessPortfolioId: string | null;
    finishEvent: EmbeddedSignupSuccessEvent;
  } | null>(null);
  const sentRef = useRef(false);

  const canLaunch = useMemo(() => sdkReady && !busy && !disabled, [sdkReady, busy, disabled]);
  const route = pathname || "/settings";
  const emailDomain = useMemo(() => {
    const normalized = String(email || "").trim().toLowerCase();
    const atIndex = normalized.lastIndexOf("@");
    return atIndex > 0 ? normalized.slice(atIndex + 1) : undefined;
  }, [email]);

  const setStatus = useCallback((message: string) => {
    const normalized = message.toLowerCase();
    const type: ToastType =
      normalized.includes("synced") || normalized.includes("setup complete")
        ? "success"
        : normalized.includes("canceled") || normalized.includes("pending")
          ? "info"
          : normalized.includes("failed") ||
              normalized.includes("error") ||
              normalized.includes("not authorized") ||
              normalized.includes("unable") ||
              normalized.includes("blocked")
            ? "error"
            : "progress";
    const durationMs = type === "progress" ? undefined : type === "error" ? 6200 : 4200;

    if (toastResetTimerRef.current) {
      window.clearTimeout(toastResetTimerRef.current);
      toastResetTimerRef.current = null;
    }

    if (toastIdRef.current) {
      toast.update(toastIdRef.current, {
        type,
        title: "WhatsApp setup",
        message,
        durationMs,
      });
    } else {
      toastIdRef.current = toast.show({
        type,
        title: "WhatsApp setup",
        message,
        durationMs,
      });
    }

    if (durationMs && toastIdRef.current) {
      const toastId = toastIdRef.current;
      toastResetTimerRef.current = window.setTimeout(() => {
        if (toastIdRef.current === toastId) {
          toastIdRef.current = null;
        }
        toastResetTimerRef.current = null;
      }, durationMs + 250);
    }
  }, [toast]);

  useEffect(() => {
    if (typeof connectedProp === "boolean") {
      setConnected(connectedProp);
    }
  }, [connectedProp]);

  useEffect(() => {
    return () => {
      if (toastResetTimerRef.current) {
        window.clearTimeout(toastResetTimerRef.current);
        toastResetTimerRef.current = null;
      }
    }
  }, []);

  // Initialize FB SDK once loaded
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    // fbAsyncInit will be called by the SDK script
    window.fbAsyncInit = function () {
      window.FB?.init({
        appId: FB_APP_ID,
        autoLogAppEvents: true,
        xfbml: true,
        version: "v24.0",
      });
      setSdkReady(true);
    };
  }, []);

  // Listen for embedded signup session info events
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Accept both facebook.com and web.facebook.com origins
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      try {
        const data = JSON.parse(event.data) as SessionEvent;
        if (data?.type === "WA_EMBEDDED_SIGNUP") {
          if (isSuccessfulEmbeddedSignupMessage(data)) {
            const phoneNumberId = typeof data.data.phone_number_id === "string" ? data.data.phone_number_id.trim() : "";
            const wabaIds = Array.from(
              new Set(
                [data.data.waba_id, ...(Array.isArray(data.data.waba_ids) ? data.data.waba_ids : [])]
                  .map((value) => (typeof value === "string" ? value.trim() : ""))
                  .filter(Boolean),
              ),
            );
            const wabaId = wabaIds[0] ?? null;
            const metaBusinessPortfolioId =
              typeof data.data.business_id === "string" && data.data.business_id.trim()
                ? data.data.business_id.trim()
                : null;

            if (!phoneNumberId) {
              setBusy(false);
              setConnected(false);
              setStatus("WhatsApp signup completed, but no phone number was returned. Please reconnect and add a phone number.");
              recordClientBusinessEvent({
                event: "whatsapp.embedded_signup_completed_without_phone",
                action: "portal-whatsapp-embedded-signup",
                area: "whatsapp",
                level: "warn",
                outcome: "missing_phone_number",
                route,
                attributes: {
                  email_domain: emailDomain,
                  finish_event: data.event,
                  meta_business_portfolio_id: metaBusinessPortfolioId,
                  waba_id: wabaId,
                  waba_ids: wabaIds.join(",") || undefined,
                },
              });
              return;
            }

            idsRef.current = {
              phoneNumberId,
              wabaId,
              wabaIds,
              metaBusinessPortfolioId,
              finishEvent: data.event,
            };
            setStatus(
              wabaId
                ? `Linked phone ${phoneNumberId} (WABA ${wabaId}). Finishing…`
                : `Linked phone ${phoneNumberId}. Finishing…`,
            );
            maybeSendToServer();
          } else if (data.event === "CANCEL") {
            setBusy(false);
            setStatus(`Signup canceled${data.data?.current_step ? ` at ${data.data.current_step}` : ""}.`);
            recordClientBusinessEvent({
              event: "whatsapp.embedded_signup_cancelled",
              action: "portal-whatsapp-embedded-signup",
              area: "whatsapp",
              level: "warn",
              outcome: "cancelled",
              route,
              attributes: {
                current_step: data.data?.current_step,
                email_domain: emailDomain,
              },
            });
          } else if (data.event === "ERROR") {
            setBusy(false);
            setStatus(`Signup error: ${data.data?.error_message || "Unknown"}`);
            recordClientBusinessEvent({
              event: "whatsapp.embedded_signup_error",
              action: "portal-whatsapp-embedded-signup",
              area: "whatsapp",
              level: "error",
              outcome: "flow_broken",
              route,
              error: new Error(data.data?.error_message || "Embedded signup returned an unknown error."),
              captureInSentry: true,
              attributes: {
                email_domain: emailDomain,
                embedded_error_code: data.data?.error_code,
                embedded_session_id: data.data?.session_id,
              },
            });
          }
        }
      } catch {
        // Non-JSON message (safe to ignore)
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailDomain, route, setStatus]);

  const fbLoginCallback = useCallback((response: any) => {
    if (response?.authResponse?.code) {
      codeRef.current = response.authResponse.code as string;
      setStatus("Received authorization code. Finishing…");
      maybeSendToServer();
    } else if (response?.status === "not_authorized" || response?.status === "unknown") {
      setBusy(false);
      setStatus("Facebook login was not authorized.");
      recordClientBusinessEvent({
        event: "whatsapp.facebook_login_not_authorized",
        action: "portal-whatsapp-embedded-signup",
        area: "whatsapp",
        level: "warn",
        outcome: "handled_failure",
        route,
        error: new Error(`Facebook login was not authorized (${String(response?.status || "unknown")}).`),
        captureInSentry: false,
        attributes: {
          email_domain: emailDomain,
          fb_status: response?.status,
          likely_user_or_browser_abort: response?.status === "unknown" ? true : undefined,
        },
      });
    } else {
      setBusy(false);
      setStatus("Facebook login did not complete properly.");
      recordClientBusinessEvent({
        event: "whatsapp.facebook_login_response_unexpected",
        action: "portal-whatsapp-embedded-signup",
        area: "whatsapp",
        level: "error",
        outcome: "flow_broken",
        route,
        error: new Error("Facebook login returned an unexpected response shape."),
        captureInSentry: true,
        attributes: {
          email_domain: emailDomain,
          fb_status: typeof response?.status === "string" ? response.status : undefined,
          has_auth_code: Boolean(response?.authResponse?.code),
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailDomain, route, setStatus]);

  const maybeSendToServer = useCallback(async () => {
    if (sentRef.current) return; // already sent
    if (!codeRef.current || !idsRef.current) return; // need both pieces first
    sentRef.current = true;
    let failureAlreadyLogged = false;
    try {
      let res: Response;
      try {
        res = await fetchWithFirebaseAuth("/api/meta/whatsapp/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            code: codeRef.current,
            wabaId: idsRef.current.wabaId,
            wabaIds: idsRef.current.wabaIds,
            metaBusinessPortfolioId: idsRef.current.metaBusinessPortfolioId,
            embeddedSignupEvent: idsRef.current.finishEvent,
            phoneNumberId: idsRef.current.phoneNumberId,
            email,
          }),
        }, {
          action: "portal-whatsapp-embedded-signup",
          area: "whatsapp",
          attributes: {
            email_domain: emailDomain,
            stage: "request",
          },
          missingConfigEvent: "whatsapp.embedded_signup_completion_failed",
          missingSessionEvent: "whatsapp.embedded_signup_completion_failed",
          onFailure: (error, report) => {
            failureAlreadyLogged = true;
            recordClientBusinessEvent({
              event: "whatsapp.embedded_signup_completion_failed",
              action: "portal-whatsapp-embedded-signup",
              area: "whatsapp",
              captureInSentry: report.captureInSentry,
              error,
              level: report.level,
              outcome: report.outcome,
              route,
              attributes: {
                email_domain: emailDomain,
                stage: "request",
              },
            });
          },
          requestFailureEvent: "whatsapp.embedded_signup_completion_failed",
          route,
          tokenFailureEvent: "whatsapp.embedded_signup_completion_failed",
        });
      } catch (error) {
        if (!failureAlreadyLogged) {
          failureAlreadyLogged = true;
          recordClientBusinessEvent({
            event: "whatsapp.embedded_signup_completion_failed",
            action: "portal-whatsapp-embedded-signup",
            area: "whatsapp",
            level: "error",
            outcome: "transport_failure",
            route,
            error: error instanceof Error ? error : new Error(String(error)),
            captureInSentry: true,
            attributes: {
              email_domain: emailDomain,
              stage: "request",
            },
          });
        }
        throw error;
      }
      const payload = (await res.json().catch(() => null)) as SyncResponse | null;
      if (!res.ok) {
        const errMsg = payload && "error" in payload ? payload.error : `Server responded ${res.status}`;
        failureAlreadyLogged = true;
        recordClientBusinessEvent({
          event: "whatsapp.embedded_signup_completion_failed",
          action: "portal-whatsapp-embedded-signup",
          area: "whatsapp",
          level: res.status >= 500 ? "error" : "warn",
          outcome: "handled_failure",
          route,
          error: new Error(errMsg),
          attributes: {
            email_domain: emailDomain,
            error_code: payload && "code" in payload ? payload.code : undefined,
            http_status: res.status,
            stage: "server_response",
          },
        });
        throw new Error(errMsg);
      }
      if (!payload || payload.ok !== true) {
        failureAlreadyLogged = true;
        const error = new Error("Unexpected server response");
        recordClientBusinessEvent({
          event: "whatsapp.embedded_signup_completion_failed",
          action: "portal-whatsapp-embedded-signup",
          area: "whatsapp",
          level: "error",
          outcome: "unexpected_response",
          route,
          error,
          captureInSentry: true,
          attributes: {
            email_domain: emailDomain,
            stage: "response_validation",
          },
        });
        throw error;
      }

      if (payload.setupComplete) {
        setStatus("WhatsApp synced. Setup complete.");
        setConnected(true);
        recordClientBusinessEvent({
          event: "whatsapp.embedded_signup_succeeded",
          action: "portal-whatsapp-embedded-signup",
          area: "whatsapp",
          level: "info",
          outcome: "success",
          route,
          attributes: {
            email_domain: emailDomain,
            phone_number_id: idsRef.current?.phoneNumberId,
            waba_id: idsRef.current?.wabaId,
            finish_event: idsRef.current?.finishEvent,
            meta_business_portfolio_id: idsRef.current?.metaBusinessPortfolioId,
          },
        });
        onConnected?.();
      } else {
        setStatus(payload.message || "WhatsApp linked, but setup is still pending on the server.");
        setConnected(false);
        recordClientBusinessEvent({
          event: "whatsapp.embedded_signup_pending",
          action: "portal-whatsapp-embedded-signup",
          area: "whatsapp",
          level: "warn",
          outcome: "pending_server_setup",
          route,
          attributes: {
            email_domain: emailDomain,
            phone_number_id: idsRef.current?.phoneNumberId,
            waba_id: idsRef.current?.wabaId,
            finish_event: idsRef.current?.finishEvent,
            meta_business_portfolio_id: idsRef.current?.metaBusinessPortfolioId,
          },
        });
      }
    } catch (err: any) {
      if (!failureAlreadyLogged) {
        recordClientBusinessEvent({
          event: "whatsapp.embedded_signup_completion_failed",
          action: "portal-whatsapp-embedded-signup",
          area: "whatsapp",
          level: "error",
          outcome: "unexpected_failure",
          route,
          error: err instanceof Error ? err : new Error(String(err)),
          captureInSentry: true,
          attributes: {
            email_domain: emailDomain,
            stage: "client_completion",
          },
        });
      }
      setStatus(`Failed to complete setup: ${err?.message || String(err)}`);
      setConnected(false);
    } finally {
      setBusy(false);
    }
  }, [email, emailDomain, onConnected, route, setStatus]);

  const launchWhatsAppSignup = useCallback(() => {
    if (disabled) {
      setBusy(false);
      setStatus(disabledReason || "This workspace needs an active plan before WhatsApp can be connected.");
      return;
    }
    if (!window.FB) {
      setBusy(false);
      setStatus("Facebook SDK is not ready yet. Please try again.");
      recordClientBusinessEvent({
        event: "whatsapp.facebook_sdk_missing",
        action: "portal-whatsapp-embedded-signup",
        area: "whatsapp",
        level: "error",
        outcome: "unexpected_failure",
        route,
        error: new Error("Facebook SDK was unavailable when embedded signup was launched."),
        captureInSentry: true,
        attributes: {
          email_domain: emailDomain,
        },
      });
      return;
    }
    setBusy(true);
    setStatus("Opening Facebook to connect WhatsApp…");
    recordClientBusinessEvent({
      event: "whatsapp.facebook_login_started",
      action: "portal-whatsapp-embedded-signup",
      area: "whatsapp",
      level: "info",
      outcome: "started",
      route,
      attributes: {
        email_domain: emailDomain,
      },
    });
    // Reset previous state
    codeRef.current = null;
    idsRef.current = null;
    sentRef.current = false;
    setConnected(false);

    try {
      window.FB.login(fbLoginCallback, {
        config_id: FB_EMBEDDED_SIGNUP_CONFIG_ID, // configuration ID goes here
        response_type: "code", // must be set to 'code' for System User access token
        override_default_response_type: true, // when true, any response types passed in the "response_type" will take precedence over the default types
        extras: { version: "v3" },
      });
    } catch (error) {
      setBusy(false);
      setStatus("Unable to open Facebook login.");
      recordClientBusinessEvent({
        event: "whatsapp.facebook_login_launch_failed",
        action: "portal-whatsapp-embedded-signup",
        area: "whatsapp",
        level: "error",
        outcome: "unexpected_failure",
        route,
        error: error instanceof Error ? error : new Error(String(error)),
        captureInSentry: true,
        attributes: {
          email_domain: emailDomain,
        },
      });
    }
  }, [disabled, disabledReason, emailDomain, fbLoginCallback, route, setStatus]);

  const baseStyle = {
    backgroundColor: "#1877f2",
    borderRadius: 999,
    color: "#fff",
    cursor: canLaunch ? "pointer" : "not-allowed",
    fontFamily: "Inter, system-ui, Helvetica, Arial, sans-serif",
    fontSize: 14,
    fontWeight: 600,
    height: 36,
    padding: "0 12px",
    opacity: canLaunch ? 1 : 0.7,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #0f172a",
    lineHeight: 1,
    transition: "transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease",
  } satisfies CSSProperties;

  const mergedStyle: CSSProperties = {
    ...baseStyle,
    ...style,
    border: connected ? style?.border ?? "1.5px solid #22c55e" : style?.border ?? baseStyle.border,
  };

  const buttonLabel = connected ? syncedLabel ?? "Synced" : busy ? "Connecting…" : label ?? "Sync WhatsApp";

  return (
    <>
      {/* Load Facebook JS SDK once after interactive */}
      <Script
        id="facebook-jssdk"
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
      />
      <button
        onClick={launchWhatsAppSignup}
        disabled={!canLaunch}
        title={!sdkReady ? "Loading Facebook SDK…" : disabledReason || undefined}
        className={className}
        style={mergedStyle}
      >
        {buttonLabel}
      </button>
    </>
  );
}
