"use client";

import { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-top">
        <Link className="auth-brand" href="/">
          <Image
            src="/8.png"
            alt="Escl8"
            width={120}
            height={36}
            style={{ objectFit: "contain" }}
          />
        </Link>
      </div>
      <div className="auth-main">{children}</div>
    </div>
  );
}
