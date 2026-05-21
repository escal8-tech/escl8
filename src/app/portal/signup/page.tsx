/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { Suspense, useEffect, useState } from "react";
import { getFirebaseIdTokenOrThrow } from "@/lib/client-auth-ops";
import { isClientErrorReported, recordClientBusinessEvent, shouldCaptureUnexpectedClientError } from "@/lib/client-business-monitoring";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { APP_ONBOARDING_ROUTE, APP_SIGNUP_ROUTE } from "@/lib/app-routes";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { trpc } from "@/utils/trpc";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SignupHeader } from "./components/SignupHeader";
import { SignupForm } from "./components/SignupForm";

function SignupPageContent() {
  const auth = getFirebaseAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite")?.trim() || "";
  const inviteMode = Boolean(inviteToken);
  const upsertUser = trpc.user.upsert.useMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    auth ? null : "Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars.",
  );

  useEffect(() => {
    if (!auth) return;
    const unsub = auth.onAuthStateChanged?.((u) => {
      if (u && !busy) router.replace(APP_ONBOARDING_ROUTE);
    });
    return () => { if (typeof unsub === "function") unsub(); };
  }, [auth, router, busy]);

  const handleSubmit = async ({ email, password, businessName, firstName, lastName, phone, country }: { email: string; password: string; businessName?: string; firstName?: string; lastName?: string; phone?: string; country?: string }) => {
    setError(null);
    setBusy(true);
    try {
      if (!auth) {
        const error = new Error("Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars.");
        recordClientBusinessEvent({
          event: "auth.signup_failed",
          action: "portal-signup",
          area: "auth",
          captureInSentry: true,
          error,
          level: "error",
          outcome: "config_missing",
          route: APP_SIGNUP_ROUTE,
          attributes: {
            auth_provider: "password",
            invite_mode: inviteMode,
          },
        });
        throw error;
      }
      await createUserWithEmailAndPassword(auth, email, password);
      await getFirebaseIdTokenOrThrow({
        action: "portal-signup",
        area: "auth",
        attributes: {
          auth_provider: "password",
          email_domain: email.split("@")[1] || null,
          invite_mode: inviteMode,
        },
        freshToken: true,
        missingConfigEvent: "auth.signup_failed",
        missingSessionEvent: "auth.signup_failed",
        route: APP_SIGNUP_ROUTE,
        tokenFailureEvent: "auth.signup_failed",
      });
      await upsertUser.mutateAsync({
        email,
        whatsappConnected: false,
        businessName: inviteMode ? undefined : businessName,
        inviteToken: inviteMode ? inviteToken : undefined,
        firstName,
        lastName,
        phone,
        country,
      });
      recordClientBusinessEvent({
        event: "auth.signup_succeeded",
        action: "portal-signup",
        area: "auth",
        outcome: "success",
        route: APP_SIGNUP_ROUTE,
        attributes: {
          auth_provider: "password",
          email_domain: email.split("@")[1] || null,
          invite_mode: inviteMode,
        },
      });
      router.push(APP_ONBOARDING_ROUTE);
    } catch (err: any) {
      console.error(err);
      if (!isClientErrorReported(err)) {
        const captureInSentry = shouldCaptureUnexpectedClientError(err);
        recordClientBusinessEvent({
          event: "auth.signup_failed",
          action: "portal-signup",
          area: "auth",
          captureInSentry,
          error: err,
          level: captureInSentry ? "error" : "warn",
          outcome: captureInSentry ? "unexpected_failure" : "handled_failure",
          route: APP_SIGNUP_ROUTE,
          attributes: {
            auth_provider: "password",
            invite_mode: inviteMode,
          },
        });
      }
      setError(err?.message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-top">
        <Link className="auth-brand" href="/">
          <img
            src="/8.png"
            alt="Escal8"
            width={120}
            height={36}
            style={{ objectFit: "contain" }}
          />
        </Link>
      </div>
      <div className="auth-main">
        <div
          style={{
            maxWidth: 520,
            width: "100%",
            padding: "32px 32px 40px",
            border: "1px solid transparent",
            outline: "2px solid var(--border)",
            outlineOffset: 0,
            borderRadius: 16,
            background: "transparent",
          }}
        >
          <SignupHeader />
          <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
            {inviteMode
              ? "Create your user account from this invite. The invite decides which business you join."
              : "Create the owner account for a new business. The workspace stays blocked until a plan is assigned in admin."}
          </p>
          <SignupForm
            busy={busy}
            error={error}
            inviteMode={inviteMode}
            onSubmit={async (data) => {
              try {
                await handleSubmit(data);
              } catch (err: any) {
                setError(err?.message || "Check email and password (min 6 chars).");
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageContent />
    </Suspense>
  );
}
