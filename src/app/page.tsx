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
  title: "Escal8 Concierge App Login | AI Customer Operations Dashboard",
  description:
    "Sign in to Escal8 Concierge, the AI customer operations app from Escal8 for WhatsApp, web chat, social inboxes, lead capture, support handoff, and ticket workflows.",
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
          breadcrumbJsonLd([{ name: "Escal8 Concierge", path: "/" }]),
        ]}
      />
      <PortalThemeProvider>
        <PortalLogin />
      </PortalThemeProvider>
    </>
  );
}
