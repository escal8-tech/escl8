"use client";

import { FormEvent, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { trpc } from "@/utils/trpc";
import { useRouter } from "next/navigation";

const COUNTRY_CODES = [
  { code: "+94", label: "Sri Lanka (+94)" },
  { code: "+60", label: "Malaysia (+60)" },
];

export default function SignupPage() {
  const auth = getFirebaseAuth();
  const router = useRouter();
  const upsertUser = trpc.user.upsert.useMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState(COUNTRY_CODES[0].code);

  const minPhoneLen = useMemo(() => 6, [country]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const email = String(data.email || "").trim();
    const password = String(data.password || "");
    const phone = String(data.phone || "").replace(/\s+/g, "");

    if (!email || !email.includes("@") || password.length < 6 || phone.length < minPhoneLen) {
      setError("Check email, password (min 6 chars), and phone number.");
      setBusy(false);
      return;
    }

    const phoneNumber = `${country}${phone}`;

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
        <h1 style={{ fontSize: 30, letterSpacing: "-0.5px" }}>Create your account</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          We'll create your portal access and set up your user profile.
        </p>

        <form onSubmit={handleSubmit} style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 18 }}>
          <input name="email" type="email" required placeholder="Work email" className="contact-input" />
          <input name="password" type="password" required placeholder="Password (min 6 chars)" className="contact-input" />

          <div style={{ display: "flex", gap: 10 }}>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="contact-input"
              style={{ flex: "0 0 160px" }}
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <input name="phone" type="tel" required placeholder="WhatsApp phone" className="contact-input" />
          </div>

          {error && <div style={{ color: "crimson", fontSize: 13 }}>{error}</div>}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary" style={{ paddingInline: 18, paddingBlock: 12, minWidth: 180, fontSize: 15 }} disabled={busy}>
              {busy ? "Please wait…" : "Create account"}
            </button>
            <a href="/portal" className="btn" style={{ paddingInline: 18, paddingBlock: 12, minWidth: 160, fontSize: 15 }}>
              Back to login
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
