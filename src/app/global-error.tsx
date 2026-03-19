"use client";

import { useEffect } from "react";

import { captureSentryException, recordSentryMetric } from "@/lib/sentry-monitoring";
import "./globals.css";

// SENTRY-OBSERVABILITY: app router render error capture.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureSentryException(error, {
      action: "global-error",
      area: "ui",
      contexts: {
        nextjs: {
          digest: error.digest || null,
        },
      },
      tags: {
        "next.error_digest": error.digest || null,
      },
    });
    recordSentryMetric("count", "escl8.ui.global_error", 1, {
      action: "global_error",
      area: "ui",
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen">
        <main
          style={{
            alignItems: "flex-start",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            justifyContent: "center",
            margin: "0 auto",
            maxWidth: 640,
            minHeight: "100vh",
            padding: "48px 24px",
          }}
        >
          <p
            style={{
              color: "#6b7280",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
            }}
          >
            Application Error
          </p>
          <h1 style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>Something went wrong.</h1>
          <p style={{ color: "#4b5563", fontSize: 16, lineHeight: 1.6, maxWidth: 520 }}>
            The issue was recorded with the current dashboard context so the failing flow can be traced.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#101828",
              border: 0,
              borderRadius: 999,
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              padding: "12px 20px",
            }}
            type="button"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
