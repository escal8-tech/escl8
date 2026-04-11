import type { Metadata } from "next";
import { PortalLogin } from "@/app/portal/components/PortalLogin";
import { PortalThemeProvider } from "@/app/portal/components/PortalThemeProvider";

export const metadata: Metadata = {
  title: "Concierge Login",
  description: "Sign in to the Escal8 Concierge application.",
};

export default function Home() {
  return (
    <PortalThemeProvider>
      <PortalLogin />
    </PortalThemeProvider>
  );
}
