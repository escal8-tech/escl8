"use client";

import { FormEvent, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { trpc } from "@/utils/trpc";
import { useRouter } from "next/navigation";

export default function PortalLogin() {
  const auth = getFirebaseAuth();
  const router = useRouter();
  const upsertUser = trpc.user.upsert.useMutation();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const email = String(data.email || "").trim();
    const password = String(data.password || "");
    const phoneNumber = String(data.phone || "");

    if (!email || !password) {
      setError("Email and password are required.");
      setBusy(false);
      return;
    }

    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }

      await upsertUser.mutateAsync({
        email,
        phoneNumber: phoneNumber || undefined,
        whatsappConnected: false,
      });

      router.push("/portal/upload");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520, padding: "60px 0 80px" }}>
      <div className="glass" style={{ padding: "32px 32px 40px" }}>
        <h1 style={{ fontSize: 30, letterSpacing: "-0.5px" }}>Portal login</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Sign in to manage your AI sales agent and upload documents.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 18 }}
        >
          <input
            name="email"
            type="email"
            required
            placeholder="Work email"
            className="contact-input"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className="contact-input"
          />
          <input
            name="phone"
            type="tel"
            placeholder="WhatsApp phone (optional)"
            className="contact-input"
          />

          {error && (
            <div style={{ color: "crimson", fontSize: 13 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ marginTop: 4 }}
            disabled={busy}
          >
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>

          <button
            type="button"
            className="btn"
            style={{ marginTop: 6, fontSize: 13, paddingBlock: 8 }}
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login"
              ? "New here? Create an account"
              : "Already have an account? Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
