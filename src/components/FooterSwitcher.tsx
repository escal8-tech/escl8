"use client";

import Footer from "@/components/Footer";
import { usePathname } from "next/navigation";

export default function FooterSwitcher() {
  const pathname = usePathname();
  // Hide footer on all portal pages
  if (pathname?.startsWith("/portal")) return null;
  return <Footer />;
}
