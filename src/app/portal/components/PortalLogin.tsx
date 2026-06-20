/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { getFirebaseIdTokenOrThrow } from "@/lib/client-auth-ops";
import { isClientErrorReported, recordClientBusinessEvent, shouldCaptureUnexpectedClientError } from "@/lib/client-business-monitoring";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { APP_DEFAULT_AUTH_REDIRECT, APP_LOGIN_ROUTE } from "@/lib/app-routes";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { isSafeInternalRedirect } from "@/lib/safe-redirect";
import { AuthLayout } from "./AuthLayout";
import { LoginForm, LoginFormState } from "./LoginForm";

export function PortalLogin() {
  const auth = getFirebaseAuth();
  const router = useRouter();
  const redirectingRef = useRef(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [state, setState] = useState<LoginFormState>({
    busy: false,
    error: null,
  });
  const [isRestoringSession, setIsRestoringSession] = useState(false);

  const getRedirectUrl = useCallback(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("redirect");
    return isSafeInternalRedirect(raw) ? raw : null;
  }, []);

  const establishEscal8Session = useCallback(async (idToken: string): Promise<void> => {
    const tokenResponse = await fetch("/api/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, module: "agent" }),
      credentials: "include",
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.json().catch(() => ({}));
      console.error("[PortalLogin] Token exchange failed:", tokenResponse.status, err);
      throw new Error("Unable to finish sign-in. Please try again.");
    }
  }, []);

  const completeFirebaseLogin = useCallback(async (input: {
    action: string;
    attributes?: Record<string, string | number | boolean | null | undefined>;
    event: string;
    freshToken?: boolean;
  }) => {
    if (redirectingRef.current) return true;
    redirectingRef.current = true;

    const idToken = await getFirebaseIdTokenOrThrow({
      action: input.action,
      area: "auth",
      attributes: input.attributes,
      freshToken: input.freshToken,
      missingConfigEvent: input.event,
      missingSessionEvent: input.event,
      route: APP_LOGIN_ROUTE,
      tokenFailureEvent: input.event,
    });

    await establishEscal8Session(idToken);

    const nextPath = getRedirectUrl() ?? APP_DEFAULT_AUTH_REDIRECT;
    router.replace(nextPath);
    router.refresh();
    return true;
  }, [establishEscal8Session, getRedirectUrl, router]);

  useEffect(() => {
    if (!auth) {
      setAuthChecked(true);
      setState(s => ({ ...s, error: "Firebase auth is not configured." }));
      return;
    }
    setAuthChecked(false);
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthChecked(true);
      if (u) {
        setIsRestoringSession(true);
        setState((s) => ({ ...s, busy: true, error: null }));
        try {
          await completeFirebaseLogin({
            action: "portal-restore-session",
            event: "auth.session_restore_failed",
            freshToken: true,
          });
        } catch (err: any) {
          await auth.signOut().catch(() => {});
          redirectingRef.current = false;
          if (!isClientErrorReported(err)) {
            recordClientBusinessEvent({
              event: "auth.session_restore_failed",
              action: "portal-restore-session",
              area: "auth",
              captureInSentry: true,
              error: err instanceof Error ? err : new Error(String(err)),
              level: "error",
              outcome: "unexpected_failure",
              route: APP_LOGIN_ROUTE,
            });
          }
          setIsRestoringSession(false);
          setState({
            busy: false,
            error: err?.message || "Unable to continue your session. Please sign in again.",
          });
        }
      }
    });
    return () => unsub();
  }, [auth, completeFirebaseLogin]);

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

      const cred = await signInWithEmailAndPassword(auth, email, password);
      void cred;
      await completeFirebaseLogin({
        action: "portal-email-login",
        attributes: {
          auth_provider: "password",
          email_domain: email.split("@")[1] || null,
        },
        freshToken: true,
        event: "auth.email_login_failed",
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
    } catch (err: any) {
      await getFirebaseAuth()?.signOut().catch(() => {});
      redirectingRef.current = false;
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
      await completeFirebaseLogin({
        action: "portal-google-login",
        attributes: {
          auth_provider: "google",
          email_domain: googleEmail.split("@")[1] || null,
        },
        freshToken: true,
        event: "auth.google_login_failed",
      });
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
    } catch (err: any) {
      await getFirebaseAuth()?.signOut().catch(() => {});
      redirectingRef.current = false;
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

  if (!authChecked || isRestoringSession) {
    return (
      <div className="min-h-screen relative flex items-center justify-center bg-dark-900">
        <div className="absolute inset-0 bg-dark-950 -z-10" />
        <div className="relative z-10 flex flex-col items-center gap-4 text-dark-100">
          <div className="w-8 h-8 rounded-full border-2 border-accent-gold/20 border-t-accent-gold animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <AuthLayout>
      <LoginForm state={state} onSubmit={handleSubmit} onGoogle={handleGoogle} />
    </AuthLayout>
  );
}
