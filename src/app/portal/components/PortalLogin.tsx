"use client";

import { FormEvent, useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "firebase/auth";
import { trpc } from "@/utils/trpc";
import { useRouter } from "next/navigation";
import { AuthLayout } from "./AuthLayout";
import { LoginForm, LoginFormState } from "./LoginForm";

export function PortalLogin() {
  const auth = getFirebaseAuth();
  const router = useRouter();
  const upsertUser = trpc.user.upsert.useMutation();
  const [state, setState] = useState<LoginFormState>({ busy: false, error: null });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) router.replace("/portal/upload");
    });
    return () => unsub();
  }, [auth, router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState((s) => ({ ...s, error: null, busy: true }));

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
      router.push("/portal/upload");
    } catch (err: any) {
      console.error(err);
      setState({ busy: false, error: err?.message || "Unable to sign in." });
    } finally {
      setState((s) => ({ ...s, busy: false }));
    }
  };

  const handleGoogle = async () => {
    try {
      setState((s) => ({ ...s, busy: true, error: null }));
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      const googleEmail = res.user.email;
      if (!googleEmail) throw new Error("Google account has no email attached.");
      await upsertUser.mutateAsync({ email: googleEmail, whatsappConnected: false });
      router.push("/portal/upload");
    } catch (err: any) {
      console.error(err);
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
