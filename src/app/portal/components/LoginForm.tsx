"use client";

import { FormEvent } from "react";

export type LoginFormState = {
  busy: boolean;
  error: string | null;
};

export function LoginForm({ state, onSubmit, onGoogle }: {
  state: LoginFormState;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onGoogle: () => Promise<void> | void;
}) {
  return (
    <div className="frost-card" style={{ width: "100%", maxWidth: 720, padding: "40px 44px 48px" }}>
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.5px", marginBottom: 8, color: "var(--foreground)" }}>Welcome Back</h1>
        <p style={{ fontSize: 14, color: "var(--muted)" }}>Sign in to your Escl8 account</p>
      </div>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--foreground)" }}>Email Address</label>
          <input name="email" type="email" required placeholder="you@example.com" className="contact-input" style={{ height: 44 }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--foreground)" }}>Password</label>
          <input name="password" type="password" required placeholder="••••••••" className="contact-input" style={{ height: 44 }} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" style={{ width: 16, height: 16, accentColor: "var(--gold)" }} /> Remember me
          </label>
          <a href="#" style={{ fontSize: 13, color: "var(--gold-light)" }}>Forgot password?</a>
        </div>

        {state.error && <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "var(--danger-light)", borderRadius: 8 }}>{state.error}</div>}

        <button type="submit" className="btn btn-gold" style={{ width: "100%", height: 44, justifyContent: "center", marginTop: 4 }} disabled={state.busy}>
          {state.busy ? "Signing in…" : "Sign In"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>or continue with</span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <button
          type="button"
          className="btn"
          onClick={onGoogle}
          style={{ width: "100%", height: 44, justifyContent: "center" }}
          disabled={state.busy}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path fill="#FFC107" d="M43.61 20.083h-1.61V20H24v8h11.303C33.98 31.91 29.41 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C33.861 6.029 29.169 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.39-3.917z"/>
              <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.431 16.264 18.847 12 24 12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C33.861 6.029 29.169 4 24 4 16.318 4 9.676 8.337 6.306 14.691z"/>
              <path fill="#4CAF50" d="M24 44c5.356 0 10.205-2.053 13.86-5.393l-6.392-5.405C29.41 36 24.84 31.91 24 31.91c-4.797 0-8.862-3.132-10.346-7.434l-6.51 5.02C9.47 37.63 16.143 44 24 44z"/>
              <path fill="#1976D2" d="M43.61 20.083H42V20H24v8h11.303c-1.111 3.262-3.61 5.82-6.43 7.202l.001-.001 6.392 5.405C37.696 38.664 44 32 44 24c0-1.341-.138-2.65-.39-3.917z"/>
            </svg>
            Google
          </span>
        </button>

        <p style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
          Don&apos;t have an account? <a href="/portal/signup" style={{ color: "var(--gold-light)", fontWeight: 500 }}>Sign up</a>
        </p>
      </form>
    </div>
  );
}
