"use client";

import Nav from "@/components/Nav";
import { usePathname } from "next/navigation";

export default function TopNavSwitcher() {
  const pathname = usePathname();
  if (pathname?.startsWith("/portal")) return null;
  return <Nav />;
}
