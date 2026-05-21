"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type SignupData = {
  email: string;
  password: string;
  businessName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  country?: string;
};

type Props = {
  busy: boolean;
  error: string | null;
  inviteMode?: boolean;
  onSubmit: (data: SignupData) => Promise<void>;
};

const inputStyle = "contact-input";

export function SignupForm({ busy, error, inviteMode = false, onSubmit }: Props) {
  const [accepted, setAccepted] = useState(true);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");
    const businessName = String(data.businessName || "").trim();
    const firstName = String(data.firstName || "").trim();
    const lastName = String(data.lastName || "").trim();
    const phone = String(data.phone || "").trim();
    const country = String(data.country || "").trim();

    if (!email || !email.includes("@") || password.length < 6) {
      throw new Error("Check email and password (min 6 chars).");
    }
    if (!inviteMode && !businessName) {
      throw new Error("Business name is required.");
    }
    if (!firstName || !lastName) {
      throw new Error("First and last name are required.");
    }
    if (!accepted) {
      throw new Error("Accept the terms to continue.");
    }

    await onSubmit({ email, password, businessName: inviteMode ? undefined : businessName, firstName, lastName, phone, country });
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <input name="firstName" type="text" required placeholder="First name" className={inputStyle} />
        <input name="lastName" type="text" required placeholder="Last name" className={inputStyle} />
      </div>
      {!inviteMode ? <input name="businessName" type="text" required placeholder="Business name clients will see" className={inputStyle} /> : null}
      <input name="email" type="email" required placeholder="Work email" className={inputStyle} />
      <input name="password" type="password" required placeholder="Password (min 6 chars)" className={inputStyle} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <input name="phone" type="tel" placeholder="Mobile number" className={inputStyle} />
        <input name="country" type="text" placeholder="Country" className={inputStyle} />
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
        <span>I agree to the Privacy Policy, Terms of Service, and business account terms.</span>
      </label>

      {error && <div style={{ color: "crimson", fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary" style={{ paddingInline: 18, paddingBlock: 12, minWidth: 180, fontSize: 15 }} disabled={busy}>
          {busy ? "Please wait..." : inviteMode ? "Accept invite" : "Create business"}
        </button>
        <Link href="/" className="btn" style={{ paddingInline: 18, paddingBlock: 12, minWidth: 160, fontSize: 15 }}>
          Back to login
        </Link>
      </div>
    </form>
  );
}
