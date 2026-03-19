"use client";

import * as Sentry from "@sentry/nextjs";

export default function SentryTestButton() {
  if (process.env.NODE_ENV === "production" || !process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return null;
  }

  return (
    <button
      onClick={async () => {
        const error = new Error("Agent Dashboard Test Frontend Error");
        const eventId = Sentry.captureException(error, {
          tags: {
            "escal8.test_event": "true",
            "escal8.test_surface": "frontend",
          },
        });
        await Sentry.flush(2000);
        console.info("SENTRY_TEST_FRONTEND_EVENT_ID", eventId);
        setTimeout(() => {
          throw error;
        }, 0);
      }}
      style={{
        background: "#101828",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 999,
        bottom: 20,
        color: "#fff",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 700,
        padding: "12px 18px",
        position: "fixed",
        right: 20,
        zIndex: 9999,
      }}
      type="button"
    >
      Break the world
    </button>
  );
}
