"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

export default function SentryExamplePage() {
  const [status, setStatus] = useState("Idle");

  return (
    <main
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        justifyContent: "center",
        minHeight: "100vh",
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 760 }}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.24em", marginBottom: 12, textTransform: "uppercase" }}>
          Sentry Verification
        </p>
        <h1 style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, marginBottom: 12 }}>
          Trigger explicit frontend and backend Sentry test events
        </h1>
        <p style={{ color: "#667085", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
          This page verifies browser errors, backend errors, and error-level logs with the dashboard project&apos;s current
          error-only Sentry log policy.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
        <button
          onClick={async () => {
            setStatus("Sending frontend test log...");
            await Sentry.startSpan(
              {
                name: "agent-dashboard.sentry-example.frontend-log",
                op: "ui.action",
              },
              async () => {
                Sentry.logger.error("Agent Dashboard Frontend Test Log", {
                  log_source: "sentry_test",
                  surface: "frontend",
                });
                await Sentry.flush(2000);
              },
            );
            setStatus("Frontend test log sent. Check Sentry Logs for 'Agent Dashboard Frontend Test Log'.");
          }}
          style={buttonStyle("#0f766e")}
          type="button"
        >
          Trigger frontend log
        </button>

        <button
          onClick={async () => {
            setStatus("Sending frontend test error...");
            const error = new Error("Agent Dashboard Sentry Example Frontend Error");
            const eventId = Sentry.captureException(error, {
              tags: {
                "escal8.test_event": "true",
                "escal8.test_surface": "frontend",
              },
            });
            await Sentry.flush(2000);
            console.info("SENTRY_TEST_FRONTEND_EVENT_ID", eventId);
            setStatus(`Frontend event sent: ${eventId}`);
            setTimeout(() => {
              throw error;
            }, 0);
          }}
          style={buttonStyle("#b42318")}
          type="button"
        >
          Trigger frontend error
        </button>

        <button
          onClick={async () => {
            setStatus("Calling backend log route...");
            const response = await fetch("/api/sentry-example-log", {
              method: "POST",
              cache: "no-store",
            });
            if (response.ok) {
              setStatus("Backend test log sent. Check Sentry Logs for 'Agent Dashboard Sentry Example API Log'.");
              return;
            }
            setStatus("Backend log route failed unexpectedly.");
          }}
          style={buttonStyle("#1d4ed8")}
          type="button"
        >
          Trigger backend log
        </button>

        <button
          onClick={async () => {
            setStatus("Calling backend test route...");
            const response = await fetch("/api/sentry-example-api", {
              cache: "no-store",
            });
            if (!response.ok) {
              setStatus("Backend route threw the test error. Check Sentry Issues for 'Agent Dashboard Sentry Example API Route Error'.");
              return;
            }
            setStatus("Backend route did not fail as expected.");
          }}
          style={buttonStyle("#101828")}
          type="button"
        >
          Trigger backend error
        </button>
      </div>

      <p
        style={{
          background: "#fff",
          border: "1px solid #e4e7ec",
          borderRadius: 12,
          boxShadow: "0 4px 14px rgba(16,24,40,0.08)",
          maxWidth: 760,
          padding: "14px 16px",
          width: "100%",
        }}
      >
        {status}
      </p>
    </main>
  );
}

function buttonStyle(background: string) {
  return {
    background,
    border: "none",
    borderRadius: 999,
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.18em",
    padding: "14px 20px",
    textTransform: "uppercase" as const,
  };
}
