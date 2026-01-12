"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="site-header" style={{ width: '100%' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 72 }}>
        <Link href="/" className="brand">
          <Image
            src="/8.png"
            alt="Escl8 Logo"
            width={160}
            height={48}
            style={{ objectFit: 'contain' }}
            priority
          />
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
            className="btn btn-gold"
            style={{ marginLeft: 8, paddingInline: 18, fontSize: 14 }}
          >
            Portal
          </Link>
        </nav>
      </div>
    </header>
  );
}
