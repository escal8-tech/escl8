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
      if (u) router.replace("/portal/upload");
    });
    return () => { if (typeof unsub === "function") unsub(); };
  }, [auth, router]);

  const handleSubmit = async ({ email, password, phoneNumber }: { email: string; password: string; phoneNumber: string }) => {
    setError(null);
    setBusy(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      await upsertUser.mutateAsync({ email, phoneNumber, whatsappConnected: false });
      router.push("/portal/upload");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 520, padding: "60px 0 80px" }}>
      <div
        style={{
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
              setError(err?.message || "Check email, password (min 6 chars), and phone number.");
            }
          }}
        />
      </div>
    </div>
  );
}
