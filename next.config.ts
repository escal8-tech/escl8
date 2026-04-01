import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const sentrySourceMapsEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);
const sentryReleaseName =
  process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.NEXT_PUBLIC_APP_RELEASE;

const nextConfig: NextConfig = {
  // Produce a standalone build so we can deploy minimal artifacts
  output: "standalone",

  async redirects() {
    return [
      {
        source: "/portal",
        destination: "/",
        permanent: true,
      },
      {
        source: "/portal/:path*",
        destination: "/:path*",
        permanent: true,
      },
    ];
  },

  async rewrites() {
    return {
      beforeFiles: [
        { source: "/signup", destination: "/portal/signup" },
        { source: "/dashboard", destination: "/portal/dashboard" },
        { source: "/requests", destination: "/portal/requests" },
        { source: "/customers", destination: "/portal/customers" },
        { source: "/messages", destination: "/portal/messages" },
        { source: "/upload", destination: "/portal/upload" },
        { source: "/bookings", destination: "/portal/bookings" },
        { source: "/sync", destination: "/portal/sync" },
        { source: "/settings", destination: "/portal/settings" },
        { source: "/tickets", destination: "/portal/tickets" },
        { source: "/payments", destination: "/portal/payments" },
        { source: "/orders", destination: "/portal/orders" },
        { source: "/revenue", destination: "/portal/revenue" },
      ],
    };
  },

  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // If you ever embed the app in an iframe intentionally, switch this to SAMEORIGIN or remove.
      { key: "X-Frame-Options", value: "DENY" },
      // Lock down powerful browser features by default.
      {
        key: "Permissions-Policy",
        value:
          "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
      },
      // Best-effort HSTS (only meaningful over HTTPS, so enable in prod).
      ...(isProd
        ? [
            {
              key: "Strict-Transport-Security",
              value: "max-age=31536000; includeSubDomains",
            },
          ]
        : []),
    ];

    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          {
            key: "Document-Policy",
            value: "js-profiling",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  tunnelRoute: "/monitoring",
  release: sentryReleaseName ? { name: sentryReleaseName } : undefined,
  sourcemaps: {
    deleteSourcemapsAfterUpload: sentrySourceMapsEnabled,
    disable: !sentrySourceMapsEnabled,
  },
  webpack: {
    treeshake: {
      removeDebugLogging: process.env.NODE_ENV === "production",
    },
  },
});
