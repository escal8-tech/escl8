"use client";

import { FormEvent, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
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
    const emailOrUsername = String(data.email || "").trim();
    const password = String(data.password || "");
  const phoneNumber = String(data.phone || "");
    const submittedMode = String(data.mode || mode) === "signup" ? "signup" : "login";
    // Reflect submitted mode in UI state
    if (submittedMode !== mode) setMode(submittedMode);

    if (!emailOrUsername || !password || !phoneNumber) {
      setError("Email/username, password and WhatsApp phone are required.");
      setBusy(false);
      return;
    }

    try {
      // Dev-only admin override using env vars; allows logging in with admin/admin
      const ADMIN_USER = process.env.NEXT_PUBLIC_ADMIN_USERNAME || "";
      const ADMIN_PASS = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "";
      const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || "admin@escl8.local";

      if (emailOrUsername === ADMIN_USER && password === ADMIN_PASS) {
        // Optional: upsert admin profile when phone provided
        if (phoneNumber && phoneNumber.length >= 5) {
          try {
            await upsertUser.mutateAsync({
              email: ADMIN_EMAIL,
              phoneNumber,
              whatsappConnected: false,
            });
          } catch {}
        }
        // Set a simple client cookie to bypass Firebase for dev admin
        document.cookie = `dev_admin=1; path=/; max-age=${7 * 24 * 60 * 60}`;
        router.push("/portal/upload");
        return;
      }

      const email = emailOrUsername;
      if (!email.includes("@")) {
        throw new Error("Please enter a valid email address or use the admin username.");
      }

      if (submittedMode === "login") {
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
            type="text"
            required
            placeholder="Email or username (admin)"
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
            required
            placeholder="WhatsApp phone"
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
              Continue with Google
            </button>
            <button
              type="submit"
              name="mode"
              value="login"
              className="btn btn-primary"
              style={{ paddingInline: 18, paddingBlock: 12, minWidth: 140, fontSize: 15 }}
              disabled={busy}
            >
              {busy && mode === "login" ? "Please wait…" : "Log in"}
            </button>
            <button
              type="submit"
              name="mode"
              value="signup"
              className="btn"
              style={{ paddingInline: 18, paddingBlock: 12, minWidth: 160, fontSize: 15 }}
              disabled={busy}
            >
              {busy && mode === "signup" ? "Please wait…" : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
