"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function PortalNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");
  return (
    <header className="site-header">
      <div className="container header-inner">
        <div className="brand">
          <span className="brand-mark">P</span>
          <span className="brand-name">Escl8 Portal</span>
        </div>
        <nav className="nav">
          <Link className="nav-link" href="/">Website</Link>
          <Link className={`nav-link ${isActive("/portal/upload") ? "active" : ""}`} href="/portal/upload">Upload</Link>
          <Link className={`nav-link ${isActive("/portal/dashboard") ? "active" : ""}`} href="/portal/dashboard">Dashboard</Link>
          <Link className={`nav-link ${isActive("/portal/bookings") ? "active" : ""}`} href="/portal/bookings">Bookings</Link>
            <Link className={`nav-link ${isActive("/portal/sync") ? "active" : ""}`} href="/portal/sync">Sync</Link>
          <Link className={`nav-link ${isActive("/portal/settings") ? "active" : ""}`} href="/portal/settings">Settings</Link>
        </nav>
      </div>
    </header>
  );
}
