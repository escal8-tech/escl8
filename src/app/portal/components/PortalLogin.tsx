/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "firebase/auth";
import { trpc } from "@/utils/trpc";
import { useRouter } from "next/navigation";
import { AuthLayout } from "./AuthLayout";
import { LoginForm, LoginFormState } from "./LoginForm";
import { recordClientBusinessEvent, shouldCaptureUnexpectedClientError } from "@/lib/client-business-monitoring";

export function PortalLogin() {
  const auth = getFirebaseAuth();
  const router = useRouter();
  const upsertUser = trpc.user.upsert.useMutation();
  const [state, setState] = useState<LoginFormState>({
    busy: false,
    error: auth ? null : "Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars.",
  });

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) router.replace("/portal/upload");
    });
    return () => unsub();
  }, [auth, router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState((s) => ({ ...s, error: null, busy: true }));
    if (!auth) {
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
      await auth.currentUser?.getIdToken(true);
      recordClientBusinessEvent({
        event: "auth.email_login_succeeded",
        action: "portal-email-login",
        area: "auth",
        outcome: "success",
        route: "/portal",
        attributes: {
          auth_provider: "password",
          email_domain: email.split("@")[1] || null,
        },
      });
      router.push("/portal/upload");
    } catch (err: any) {
      console.error(err);
      const captureInSentry = shouldCaptureUnexpectedClientError(err);
      recordClientBusinessEvent({
        event: "auth.email_login_failed",
        action: "portal-email-login",
        area: "auth",
        captureInSentry,
        error: err,
        level: captureInSentry ? "error" : "warn",
        outcome: captureInSentry ? "unexpected_failure" : "handled_failure",
        route: "/portal",
        attributes: {
          auth_provider: "password",
          email_domain: emailOrUsername.includes("@") ? emailOrUsername.split("@")[1] || null : null,
        },
      });
      setState({ busy: false, error: err?.message || "Unable to sign in." });
    } finally {
      setState((s) => ({ ...s, busy: false }));
    }
  };

  const handleGoogle = async () => {
    try {
      setState((s) => ({ ...s, busy: true, error: null }));
      if (!auth) throw new Error("Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars.");
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      const googleEmail = res.user.email;
      if (!googleEmail) throw new Error("Google account has no email attached.");
      await auth.currentUser?.getIdToken(true);
      await upsertUser.mutateAsync({ email: googleEmail, whatsappConnected: false });
      recordClientBusinessEvent({
        event: "auth.google_login_succeeded",
        action: "portal-google-login",
        area: "auth",
        outcome: "success",
        route: "/portal",
        attributes: {
          auth_provider: "google",
          email_domain: googleEmail.split("@")[1] || null,
        },
      });
      router.push("/portal/upload");
    } catch (err: any) {
      console.error(err);
      const captureInSentry = shouldCaptureUnexpectedClientError(err);
      recordClientBusinessEvent({
        event: "auth.google_login_failed",
        action: "portal-google-login",
        area: "auth",
        captureInSentry,
        error: err,
        level: captureInSentry ? "error" : "warn",
        outcome: captureInSentry ? "unexpected_failure" : "handled_failure",
        route: "/portal",
        attributes: {
          auth_provider: "google",
        },
      });
      setState((s) => ({ ...s, error: err?.message || "Google sign-in failed." }));
    } finally {
      setState((s) => ({ ...s, busy: false }));
    }
  };

  return (
    <AuthLayout>
      <LoginForm state={state} onSubmit={handleSubmit} onGoogle={handleGoogle} />
    </AuthLayout>
  );
}
