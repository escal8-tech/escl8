"use client";

import Link from "next/link";

type Props = {
  email: string | null;
  onLogout: () => Promise<void> | void;
};

export function ProfileCard({ email, onLogout }: Props) {
  return (
    <div className="glass" style={{ padding: 18, display: "grid", gap: 10 }}>
      <div>
        <div className="muted" style={{ fontSize: 12 }}>Logged in email</div>
        <div style={{ fontWeight: 600 }}>{email || "—"}</div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button className="btn" onClick={onLogout}>Log out</button>
        <Link className="btn" href="/portal/dashboard">Back to Dashboard</Link>
      </div>
    </div>
  );
}
