"use client";

import { FormEvent, useMemo, useState } from "react";

const COUNTRY_CODES = [
  { code: "+94", label: "Sri Lanka (+94)" },
  { code: "+60", label: "Malaysia (+60)" },
];

type Props = {
  busy: boolean;
  error: string | null;
  onSubmit: (data: { email: string; password: string; phoneNumber: string }) => Promise<void>;
};

export function SignupForm({ busy, error, onSubmit }: Props) {
  const [country, setCountry] = useState(COUNTRY_CODES[0].code);
  const minPhoneLen = useMemo(() => 6, [country]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const email = String(data.email || "").trim();
    const password = String(data.password || "");
    const phone = String(data.phone || "").replace(/\s+/g, "");

    if (!email || !email.includes("@") || password.length < 6 || phone.length < minPhoneLen) {
      throw new Error("Check email, password (min 6 chars), and phone number.");
    }

    const phoneNumber = `${country}${phone}`;
    await onSubmit({ email, password, phoneNumber });
  };

  return (
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
  );
}
