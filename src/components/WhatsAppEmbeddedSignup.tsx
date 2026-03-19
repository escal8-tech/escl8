/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { fetchWithFirebaseAuth } from "@/lib/client-auth-ops";
import { recordClientBusinessEvent } from "@/lib/client-business-monitoring";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

type SessionEvent =
  | { type: "WA_EMBEDDED_SIGNUP"; event: "FINISH"; data: { phone_number_id: string; waba_id: string } }
  | { type: "WA_EMBEDDED_SIGNUP"; event: "CANCEL"; data: { current_step?: string } }
  | { type: "WA_EMBEDDED_SIGNUP"; event: "ERROR"; data: { error_message?: string } };

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
  className?: string;
  style?: React.CSSProperties;
};

type SyncResponse =
  | { ok: true; stored: boolean; setupComplete: boolean; message?: string }
  | { ok: false; error: string; code?: string };

export function WhatsAppEmbeddedSignupButton({ email, onConnected, label, syncedLabel, connected: connectedProp, className, style }: WhatsAppEmbeddedSignupButtonProps = {}) {
  const pathname = usePathname();
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Store whichever arrives first and combine later
  const codeRef = useRef<string | null>(null);
  const idsRef = useRef<{ phoneNumberId: string; wabaId: string } | null>(null);
  const sentRef = useRef(false);

  const canLaunch = useMemo(() => sdkReady && !busy, [sdkReady, busy]);
  const route = pathname || "/portal/settings";
  const emailDomain = useMemo(() => {
    const normalized = String(email || "").trim().toLowerCase();
    const atIndex = normalized.lastIndexOf("@");
    return atIndex > 0 ? normalized.slice(atIndex + 1) : undefined;
  }, [email]);

  useEffect(() => {
    if (typeof connectedProp === "boolean") {
      setConnected(connectedProp);
    }
  }, [connectedProp]);

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
          if (data.event === "FINISH") {
            const phoneNumberId = data.data.phone_number_id;
            const wabaId = data.data.waba_id;
            idsRef.current = { phoneNumberId, wabaId };
            setStatus(`Linked phone ${phoneNumberId} (WABA ${wabaId}). Finishing…`);
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
  }, [emailDomain, route]);

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
        level: "error",
        outcome: "flow_broken",
        route,
        error: new Error(`Facebook login was not authorized (${String(response?.status || "unknown")}).`),
        captureInSentry: true,
        attributes: {
          email_domain: emailDomain,
          fb_status: response?.status,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailDomain, route]);

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
        onConnected?.();
      } else {
        setStatus(payload.message || "WhatsApp linked, but setup is still pending on the server.");
        setConnected(false);
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
  }, [email, emailDomain, onConnected, route]);

  const launchWhatsAppSignup = useCallback(() => {
    if (!window.FB) return;
    setBusy(true);
    setStatus("Opening Facebook to connect WhatsApp…");
    // Reset previous state
    codeRef.current = null;
    idsRef.current = null;
    sentRef.current = false;
    setConnected(false);

    window.FB.login(fbLoginCallback, {
      config_id: FB_EMBEDDED_SIGNUP_CONFIG_ID, // configuration ID goes here
      response_type: "code", // must be set to 'code' for System User access token
      override_default_response_type: true, // when true, any response types passed in the "response_type" will take precedence over the default types
      extras: { version: "v3" },
    });
  }, [fbLoginCallback]);

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
        title={!sdkReady ? "Loading Facebook SDK…" : undefined}
        className={className}
        style={mergedStyle}
      >
        {buttonLabel}
      </button>
      {status && (
        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          {status}
        </div>
      )}
    </>
  );
}
