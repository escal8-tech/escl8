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
    <div className="auth-screen">
      {/* Top-left brand */}
      <div className="auth-top">
        <a className="auth-brand" href="/">
          <span className="mark" />
          <strong>Escal8</strong>
        </a>
      </div>
      {/* Centered login card */}
      <div className="auth-main">
        <div className="frost-card" style={{ width: "100%", maxWidth: 520, padding: "28px 28px 34px" }}>
          <div style={{ marginBottom: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Sign in to Escal8</div>
            <h1 style={{ fontSize: 30, letterSpacing: "-0.5px", marginTop: 6 }}>Welcome Back</h1>
          </div>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ fontSize: 12 }}>Email Address</label>
            <input name="email" type="email" required placeholder="you@example.com" className="contact-input" />
            <label style={{ fontSize: 12, marginTop: 6 }}>Password</label>
            <input name="password" type="password" required placeholder="Password" className="contact-input" />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" /> Remember me
              </label>
              <a href="#" className="muted" style={{ fontSize: 13 }}>Forgot your password?</a>
            </div>

            {error && <div style={{ color: "crimson", fontSize: 13 }}>{error}</div>}

            <button type="submit" className="btn" style={{ width: "100%", height: 44, justifyContent: "center", background: "#1f3568", color: "#fff", border: 0, marginTop: 10 }} disabled={busy}>
              {busy ? "Please wait…" : "Sign In"}
            </button>

            <div className="footer-separator" style={{ margin: "16px 0" }} />
            <div className="muted" style={{ textAlign: "center", fontSize: 13 }}>
              Don’t have an account? <a href="/portal/signup">Register here</a>
            </div>

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
              style={{ width: "100%", justifyContent: "center" }}
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
          </form>
        </div>
      </div>
    </div>
  );
}
