"use client";

import Nav from "@/components/Nav";
import { isAppPath } from "@/lib/app-routes";
import { usePathname } from "next/navigation";

export default function TopNavSwitcher() {
  const pathname = usePathname();
  if (!pathname || isAppPath(pathname)) return null;
  return <Nav />;
}
