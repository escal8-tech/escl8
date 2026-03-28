import type { Metadata } from "next";
import { PortalLogin } from "@/app/portal/components/PortalLogin";
import { PortalThemeProvider } from "@/app/portal/components/PortalThemeProvider";

export const metadata: Metadata = {
  title: "Escl8 Concierge Login",
  description: "Sign in to the Escl8 Concierge application.",
};

export default function Home() {
  return (
    <PortalThemeProvider>
      <PortalLogin />
    </PortalThemeProvider>
  );
}
