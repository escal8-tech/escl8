"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/data-deletion", label: "Data Deletion" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">⚡</span>
          <span className="brand-name">Escl8</span>
        </Link>
        <nav className="nav" style={{ alignItems: "center", gap: 10 }}>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link ${pathname === l.href ? "active" : ""}`}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/portal"
            className="btn btn-primary"
            style={{ marginLeft: 8, paddingInline: 18, fontSize: 14 }}
          >
            Portal
          </Link>
        </nav>
      </div>
    </header>
  );
}
