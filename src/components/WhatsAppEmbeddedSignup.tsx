"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  onConnected?: () => void;
  label?: string;
  syncedLabel?: string;
  className?: string;
  style?: React.CSSProperties;
};

export function WhatsAppEmbeddedSignupButton({ onConnected, label, syncedLabel, className, style }: WhatsAppEmbeddedSignupButtonProps = {}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Store whichever arrives first and combine later
  const codeRef = useRef<string | null>(null);
  const idsRef = useRef<{ phoneNumberId: string; wabaId: string } | null>(null);
  const sentRef = useRef(false);

  const canLaunch = useMemo(() => sdkReady && !busy, [sdkReady, busy]);

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
          } else if (data.event === "ERROR") {
            setBusy(false);
            setStatus(`Signup error: ${data.data?.error_message || "Unknown"}`);
          }
        }
      } catch {
        // Non-JSON message (safe to ignore)
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fbLoginCallback = useCallback((response: any) => {
    if (response?.authResponse?.code) {
      codeRef.current = response.authResponse.code as string;
      setStatus("Received authorization code. Finishing…");
      maybeSendToServer();
    } else if (response?.status === "not_authorized" || response?.status === "unknown") {
      setBusy(false);
      setStatus("Facebook login was not authorized.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maybeSendToServer = useCallback(async () => {
    if (sentRef.current) return; // already sent
    if (!codeRef.current || !idsRef.current) return; // need both pieces first
    sentRef.current = true;
    try {
      const res = await fetch("/api/meta/whatsapp/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: codeRef.current,
          wabaId: idsRef.current.wabaId,
          phoneNumberId: idsRef.current.phoneNumberId,
        }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setStatus("WhatsApp connected. We’ll finish setup in the background.");
      setConnected(true);
      onConnected?.();
    } catch (err: any) {
      setStatus(`Failed to complete setup: ${err?.message || String(err)}`);
      setConnected(false);
    } finally {
      setBusy(false);
    }
  }, []);

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
