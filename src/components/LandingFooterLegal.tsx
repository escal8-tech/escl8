import Image from "next/image";
import Link from "next/link";
import styles from "./LandingFooterLegal.module.css";

export default function LandingFooterLegal() {
  return (
    <footer className={styles.footerMeta}>
      <div className={styles.footerBrand}>
        <div className={styles.brandMini}>
          <Image src="/favikon.png" alt="" width={22} height={22} />
          <span>Escal8</span>
        </div>
        <span>© 2026 Escalate Tech Services Sdn Bhd. All rights reserved.</span>
      </div>
      <nav className={styles.footerLinks} aria-label="Footer links">
        <Link href="/pricing">Pricing</Link>
        <Link href="/faq">FAQ</Link>
        <Link href="/terms">Terms of Use</Link>
        <Link href="/data-deletion">Legal</Link>
        <Link href="/privacy">Privacy Policy</Link>
      </nav>
    </footer>
  );
}

