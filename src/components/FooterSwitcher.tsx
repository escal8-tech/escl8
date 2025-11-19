"use client";

import Footer from "@/components/Footer";
import { usePathname } from "next/navigation";

export default function FooterSwitcher() {
  const pathname = usePathname();
  // Hide footer on portal auth pages
  if (pathname === "/portal" || pathname?.startsWith("/portal/signup")) return null;
  return <Footer />;
}
