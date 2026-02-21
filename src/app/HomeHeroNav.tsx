"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

export default function HomeHeroNav() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 50);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`${styles.heroNav} ${isScrolled ? styles.heroNavScrolled : ""}`}>
      <Link href="/" className={styles.brand} aria-label="Escalate home">
        <Image
          src="/landing/logo-main-wordmark.png"
          alt="Escalate"
          width={92}
          height={23}
          priority
          className={styles.brandWordmark}
        />
        <Image
          src="/landing/nav-infinity-crop.png"
          alt=""
          width={30}
          height={13}
          priority
          className={styles.brandInfinity}
        />
      </Link>

      <nav className={styles.navLinks} aria-label="Main navigation">
        <Link href="/" className={styles.navLinkActive}>
          Home
        </Link>
        <Link href="/pricing" className={styles.navLink}>
          Pricing
        </Link>
        <Link href="/faq" className={styles.navLink}>
          FAQ
        </Link>
      </nav>

      <Link href="/portal" className={styles.navCta}>
        Sign Up
      </Link>
    </header>
  );
}
