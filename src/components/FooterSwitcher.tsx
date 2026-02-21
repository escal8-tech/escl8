"use client";

import Footer from "@/components/Footer";
import { usePathname } from "next/navigation";

export default function FooterSwitcher() {
  const pathname = usePathname();
  if (!pathname || pathname === "/" || pathname.startsWith("/portal")) return null;
  return <Footer />;
}

