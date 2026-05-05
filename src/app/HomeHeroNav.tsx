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
      <Link href="/" className={styles.brand} aria-label="Escal8 home">
        <Image
          src="/landing/logo-main-wordmark.png"
          alt="Escal8"
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
        <Link href="https://www.escal8.tech/concierge/pricing" className={styles.navLink}>
          Pricing
        </Link>
        <Link href="https://www.escal8.tech/concierge/faq" className={styles.navLink}>
          FAQ
        </Link>
      </nav>

      <Link href="/signup" className={styles.navCta}>
        Sign Up
      </Link>
    </header>
  );
}
