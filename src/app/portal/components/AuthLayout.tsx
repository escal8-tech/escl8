"use client";

import { ReactNode } from "react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-top">
        <a className="auth-brand" href="/">
          <span className="mark" />
          <strong>Escal8</strong>
        </a>
      </div>
      <div className="auth-main">{children}</div>
    </div>
  );
}
