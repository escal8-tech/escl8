/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useState } from "react";
import { getFirebaseIdTokenOrThrow } from "@/lib/client-auth-ops";
import { isClientErrorReported, recordClientBusinessEvent, shouldCaptureUnexpectedClientError } from "@/lib/client-business-monitoring";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { APP_DEFAULT_AUTH_REDIRECT, APP_LOGIN_ROUTE } from "@/lib/app-routes";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "firebase/auth";
import { trpc } from "@/utils/trpc";
import { useRouter } from "next/navigation";
import { AuthLayout } from "./AuthLayout";
import { LoginForm, LoginFormState } from "./LoginForm";

export function PortalLogin() {
  const auth = getFirebaseAuth();
  const router = useRouter();
  const upsertUser = trpc.user.upsert.useMutation();
  const [authChecked, setAuthChecked] = useState(!auth);
  const [state, setState] = useState<LoginFormState>({
    busy: false,
    error: auth ? null : "Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars.",
  });

  useEffect(() => {
    if (!auth) return;
    setAuthChecked(false);
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthChecked(true);
      if (u) {
        setState((s) => ({ ...s, busy: true, error: null }));
        router.replace(APP_DEFAULT_AUTH_REDIRECT);
      }
    });
    return () => unsub();
  }, [auth, router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState((s) => ({ ...s, error: null, busy: true }));
    if (!auth) {
      recordClientBusinessEvent({
        event: "auth.email_login_failed",
        action: "portal-email-login",
        area: "auth",
        captureInSentry: true,
        error: new Error("Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars."),
        level: "error",
        outcome: "config_missing",
        route: APP_LOGIN_ROUTE,
        attributes: {
          auth_provider: "password",
        },
      });
      setState({ busy: false, error: "Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars." });
      return;
    }

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const emailOrUsername = String(data.email || "").trim();
    const password = String(data.password || "");
    if (!emailOrUsername || !password) {
      setState({ busy: false, error: "Email/username and password are required." });
      return;
    }

    try {
      const email = emailOrUsername;
      if (!email.includes("@")) {
        throw new Error("Please enter a valid email address.");
      }

      await signInWithEmailAndPassword(auth, email, password);
      await getFirebaseIdTokenOrThrow({
        action: "portal-email-login",
        area: "auth",
        attributes: {
          auth_provider: "password",
          email_domain: email.split("@")[1] || null,
        },
        freshToken: true,
        missingConfigEvent: "auth.email_login_failed",
        missingSessionEvent: "auth.email_login_failed",
        route: APP_LOGIN_ROUTE,
        tokenFailureEvent: "auth.email_login_failed",
      });
      recordClientBusinessEvent({
        event: "auth.email_login_succeeded",
        action: "portal-email-login",
        area: "auth",
        outcome: "success",
        route: APP_LOGIN_ROUTE,
        attributes: {
          auth_provider: "password",
          email_domain: email.split("@")[1] || null,
        },
      });
      router.push(APP_DEFAULT_AUTH_REDIRECT);
    } catch (err: any) {
      console.error(err);
      if (!isClientErrorReported(err)) {
        const captureInSentry = shouldCaptureUnexpectedClientError(err);
        recordClientBusinessEvent({
          event: "auth.email_login_failed",
          action: "portal-email-login",
          area: "auth",
          captureInSentry,
          error: err,
          level: captureInSentry ? "error" : "warn",
          outcome: captureInSentry ? "unexpected_failure" : "handled_failure",
          route: APP_LOGIN_ROUTE,
          attributes: {
            auth_provider: "password",
            email_domain: emailOrUsername.includes("@") ? emailOrUsername.split("@")[1] || null : null,
          },
        });
      }
      setState({ busy: false, error: err?.message || "Unable to sign in." });
    } finally {
      setState((s) => ({ ...s, busy: false }));
    }
  };

  const handleGoogle = async () => {
    try {
      setState((s) => ({ ...s, busy: true, error: null }));
      if (!auth) {
        const error = new Error("Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars.");
        recordClientBusinessEvent({
          event: "auth.google_login_failed",
          action: "portal-google-login",
          area: "auth",
          captureInSentry: true,
          error,
          level: "error",
          outcome: "config_missing",
          route: APP_LOGIN_ROUTE,
          attributes: {
            auth_provider: "google",
          },
        });
        throw error;
      }
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      const googleEmail = res.user.email;
      if (!googleEmail) throw new Error("Google account has no email attached.");
      await getFirebaseIdTokenOrThrow({
        action: "portal-google-login",
        area: "auth",
        attributes: {
          auth_provider: "google",
          email_domain: googleEmail.split("@")[1] || null,
        },
        freshToken: true,
        missingConfigEvent: "auth.google_login_failed",
        missingSessionEvent: "auth.google_login_failed",
        route: APP_LOGIN_ROUTE,
        tokenFailureEvent: "auth.google_login_failed",
      });
      await upsertUser.mutateAsync({ email: googleEmail, whatsappConnected: false });
      recordClientBusinessEvent({
        event: "auth.google_login_succeeded",
        action: "portal-google-login",
        area: "auth",
        outcome: "success",
        route: APP_LOGIN_ROUTE,
        attributes: {
          auth_provider: "google",
          email_domain: googleEmail.split("@")[1] || null,
        },
      });
      router.push(APP_DEFAULT_AUTH_REDIRECT);
    } catch (err: any) {
      console.error(err);
      if (!isClientErrorReported(err)) {
        const captureInSentry = shouldCaptureUnexpectedClientError(err);
        recordClientBusinessEvent({
          event: "auth.google_login_failed",
          action: "portal-google-login",
          area: "auth",
          captureInSentry,
          error: err,
          level: captureInSentry ? "error" : "warn",
          outcome: captureInSentry ? "unexpected_failure" : "handled_failure",
          route: APP_LOGIN_ROUTE,
          attributes: {
            auth_provider: "google",
          },
        });
      }
      setState((s) => ({ ...s, error: err?.message || "Google sign-in failed." }));
    } finally {
      setState((s) => ({ ...s, busy: false }));
    }
  };

  if (!authChecked) {
    return (
      <AuthLayout>
        <div className="frost-card" style={{ width: "100%", maxWidth: 520, padding: "36px 40px", textAlign: "center" }}>
          <div
            aria-hidden
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              margin: "0 auto 16px",
              background: "linear-gradient(135deg, var(--gold), var(--gold-light))",
              animation: "pulse 1.2s ease-in-out infinite",
            }}
          />
          <h1 style={{ fontSize: 22, marginBottom: 8, color: "var(--foreground)" }}>Loading...</h1>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>Checking your session</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <LoginForm state={state} onSubmit={handleSubmit} onGoogle={handleGoogle} />
    </AuthLayout>
  );
}
