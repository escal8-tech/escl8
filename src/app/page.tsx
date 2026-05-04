import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { PortalLogin } from "@/app/portal/components/PortalLogin";
import { PortalThemeProvider } from "@/app/portal/components/PortalThemeProvider";
import {
  breadcrumbJsonLd,
  buildMetadata,
  conciergeSoftwareJsonLd,
  organizationJsonLd,
  websiteJsonLd,
} from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Escalate Tech Concierge App Login | AI Customer Operations Dashboard",
  description:
    "Sign in to Escalate Tech Concierge, the AI customer operations app from Escalate Tech for WhatsApp, web chat, social inboxes, lead capture, support handoff, and ticket workflows.",
  path: "/",
});

export default function Home() {
  return (
    <>
      <JsonLd
        data={[
          organizationJsonLd(),
          websiteJsonLd(),
          conciergeSoftwareJsonLd(),
          breadcrumbJsonLd([{ name: "Escalate Tech Concierge", path: "/" }]),
        ]}
      />
      <PortalThemeProvider>
        <PortalLogin />
      </PortalThemeProvider>
    </>
  );
}
