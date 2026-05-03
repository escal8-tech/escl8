"use client";

import Nav from "@/components/Nav";
import { isAppPath, isStandalonePublicPath } from "@/lib/app-routes";
import { usePathname } from "next/navigation";

export default function TopNavSwitcher() {
  const pathname = usePathname();
  if (!pathname || isAppPath(pathname) || isStandalonePublicPath(pathname)) return null;
  return <Nav />;
}
