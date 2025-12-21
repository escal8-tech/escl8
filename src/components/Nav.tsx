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
    <header className="site-header" style={{ width: '100%' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
        <Link href="/" className="brand">
          <span className="brand-mark">⚡</span>
          <span className="brand-name">Escal8 Software Services</span>
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
