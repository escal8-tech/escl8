"use client";

import { FormEvent } from "react";

type Props = {
  busy: boolean;
  error: string | null;
  onSubmit: (data: { email: string; password: string }) => Promise<void>;
};

export function SignupForm({ busy, error, onSubmit }: Props) {
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const email = String(data.email || "").trim();
    const password = String(data.password || "");

    if (!email || !email.includes("@") || password.length < 6) {
      throw new Error("Check email and password (min 6 chars).");
    }

    await onSubmit({ email, password });
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 18 }}>
      <input name="email" type="email" required placeholder="Work email" className="contact-input" />
      <input name="password" type="password" required placeholder="Password (min 6 chars)" className="contact-input" />

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
  );
}
