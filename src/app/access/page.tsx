"use client";

import Link from "next/link";
import { APP_LOGIN_ROUTE } from "@/lib/app-routes";

export default function AccessBlockedPage() {
  return (
    <div className="container" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "48px 0" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          borderRadius: 24,
          border: "1px solid rgba(148, 163, 184, 0.16)",
          background: "rgba(8, 15, 28, 0.94)",
          padding: 32,
          boxShadow: "0 28px 80px rgba(2, 6, 23, 0.42)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: 52,
              height: 52,
              borderRadius: 16,
              background: "rgba(184, 134, 11, 0.16)",
              color: "var(--accent-gold)",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            !
          </div>
          <div>
            <p className="muted" style={{ marginBottom: 4 }}>Subscription required</p>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Your workspace does not currently have product access.</h1>
          </div>
        </div>

        <p className="muted" style={{ lineHeight: 1.7, marginBottom: 24 }}>
          This tenant can sign in, but Escal8 operations stay blocked until a valid paid plan, partner grant, or demo grant is attached in the control system.
        </p>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            marginBottom: 28,
          }}
        >
          <div className="panel" style={{ padding: 18 }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>Allowed access states</p>
            <p className="muted" style={{ margin: 0 }}>Paid subscription, partner grant, or demo grant.</p>
          </div>
          <div className="panel" style={{ padding: 18 }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>What to do next</p>
            <p className="muted" style={{ margin: 0 }}>Ask your Escal8 admin team to activate billing for this tenant before connecting channels.</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a
            className="btn btn-primary"
            href="mailto:admin@escal8.tech?subject=Escal8%20Demo%20Request&body=Please%20contact%20me%20to%20activate%20a%20paid%20plan%20or%20demo%20grant%20for%20my%20tenant."
          >
            <span aria-hidden="true">$</span>
            Book a demo
          </a>
          <Link className="btn" href={APP_LOGIN_ROUTE}>
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
