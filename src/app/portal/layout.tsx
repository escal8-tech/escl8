import type { Metadata } from "next";
import PortalNav from "@/components/PortalNav";
import PortalAuthProvider from "@/components/PortalAuthProvider";

export const metadata: Metadata = {
  title: "Escl8 Portal",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  // Show dedicated PortalNav and protect portal pages with PortalAuthProvider
  return (
    <>
      <PortalNav />
      <PortalAuthProvider>
        {children}
      </PortalAuthProvider>
    </>
  );
}
