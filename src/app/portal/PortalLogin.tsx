"use client";

import { FormEvent, useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "firebase/auth";
import { trpc } from "@/utils/trpc";
import { useRouter } from "next/navigation";

export default function PortalLogin() {
  const auth = getFirebaseAuth();
  const router = useRouter();
  const upsertUser = trpc.user.upsert.useMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already authenticated, redirect away from login
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) router.replace("/portal/upload");
    });
    return () => unsub();
  }, [auth, router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const emailOrUsername = String(data.email || "").trim();
    const password = String(data.password || "");
    if (!emailOrUsername || !password) {
      setError("Email/username and password are required.");
      setBusy(false);
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
      setError(err?.message || "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

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
          

          {error && (
            <div style={{ color: "crimson", fontSize: 13 }}>
              {error}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  setBusy(true);
                  setError(null);
                  const provider = new GoogleAuthProvider();
                  const res = await signInWithPopup(auth, provider);
                  const googleEmail = res.user.email;
                  if (!googleEmail) throw new Error("Google account has no email attached.");
                  await upsertUser.mutateAsync({ email: googleEmail, whatsappConnected: false });
                  router.push("/portal/upload");
                } catch (err: any) {
                  console.error(err);
                  setError(err?.message || "Google sign-in failed.");
                } finally {
                  setBusy(false);
                }
              }}
              style={{ paddingInline: 18, paddingBlock: 12, minWidth: 200, fontSize: 15 }}
              disabled={busy}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <path fill="#FFC107" d="M43.61 20.083h-1.61V20H24v8h11.303C33.98 31.91 29.41 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C33.861 6.029 29.169 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.39-3.917z"/>
                  <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.431 16.264 18.847 12 24 12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C33.861 6.029 29.169 4 24 4 16.318 4 9.676 8.337 6.306 14.691z"/>
                  <path fill="#4CAF50" d="M24 44c5.356 0 10.205-2.053 13.86-5.393l-6.392-5.405C29.41 36 24.84 31.91 24 31.91c-4.797 0-8.862-3.132-10.346-7.434l-6.51 5.02C9.47 37.63 16.143 44 24 44z"/>
                  <path fill="#1976D2" d="M43.61 20.083H42V20H24v8h11.303c-1.111 3.262-3.61 5.82-6.43 7.202l.001-.001 6.392 5.405C37.696 38.664 44 32 44 24c0-1.341-.138-2.65-.39-3.917z"/>
                </svg>
                Continue with Google
              </span>
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ paddingInline: 18, paddingBlock: 12, minWidth: 140, fontSize: 15 }}
              disabled={busy}
            >
              {busy ? "Please wait…" : "Log in"}
            </button>
            <a href="/portal/signup" className="btn" style={{ paddingInline: 18, paddingBlock: 12, minWidth: 160, fontSize: 15 }}>
              Create account
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
