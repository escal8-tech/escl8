"use client";

import Footer from "@/components/Footer";
import { isAppPath, isStandalonePublicPath } from "@/lib/app-routes";
import { usePathname } from "next/navigation";

export default function FooterSwitcher() {
  const pathname = usePathname();
  if (
    !pathname ||
    isAppPath(pathname) ||
    isStandalonePublicPath(pathname) ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/data-deletion"
  ) {
    return null;
  }
  return <Footer />;
}
