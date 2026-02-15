/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const links = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

export default function Nav() {
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <header className={`floating-nav ${isScrolled ? "scrolled" : ""}`}>
        <div className="nav-pill">
          {/* Logo */}
          <Link href="/" className="nav-logo-link">
            <span className="logo-text">Escalate</span>
            <Image 
              src="/favikon.png" 
              alt="" 
              width={48} 
              height={48} 
              className="logo-image"
              priority
            />
          </Link>

          {/* Desktop Navigation */}
          <nav className="nav-links">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-link ${pathname === link.href ? "active" : ""}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* CTA Button */}
          <Link href="/portal" className="nav-cta">
            Sign Up
          </Link>

          {/* Mobile Menu Button */}
          <button
            className="mobile-menu-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isMobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile Menu */}
      <div className={`mobile-menu ${isMobileMenuOpen ? "open" : ""}`}>
        <div className="mobile-menu-content">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`mobile-link ${pathname === link.href ? "active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
          <Link href="/portal" className="mobile-cta">
            Sign Up
          </Link>
        </div>
      </div>
    </>
  );
}
