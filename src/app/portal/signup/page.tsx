"use client";

import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { trpc } from "@/utils/trpc";
import { useRouter } from "next/navigation";
import { SignupHeader } from "./components/SignupHeader";
import { SignupForm } from "./components/SignupForm";

export default function SignupPage() {
  const auth = getFirebaseAuth();
  const router = useRouter();
  const upsertUser = trpc.user.upsert.useMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged?.((u) => {
      // If a user is already logged in and we're not mid-signup,
      // redirect away from the signup page.
      // Important: during signup, Firebase signs in immediately after account creation;
      // redirecting here can interrupt the DB upsert that persists phone_number.
      if (u && !busy) router.replace("/portal/upload");
    });
    return () => { if (typeof unsub === "function") unsub(); };
  }, [auth, router, busy]);

  const handleSubmit = async ({ email, password }: { email: string; password: string }) => {
    setError(null);
    setBusy(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      await upsertUser.mutateAsync({ email, whatsappConnected: false });
      router.push("/portal/upload");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-top">
        <a className="auth-brand" href="/">
          <img
            src="/8.png"
            alt="Escl8"
            width={120}
            height={36}
            style={{ objectFit: "contain" }}
          />
        </a>
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
          <SignupForm
            busy={busy}
            error={error}
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
