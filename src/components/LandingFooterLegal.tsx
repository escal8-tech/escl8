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
        <span>© 2026 Escal8. All rights reserved.</span>
      </div>
      <nav className={styles.footerLinks} aria-label="Footer links">
        <Link href="https://www.escal8.tech/concierge/about">About</Link>
        <Link href="https://www.escal8.tech/concierge/answers">Answers</Link>
        <Link href="https://www.escal8.tech/concierge/profiles">Profiles</Link>
        <Link href="https://www.escal8.tech/concierge/pricing">Pricing</Link>
        <Link href="https://www.escal8.tech/concierge/faq">FAQ</Link>
        <Link href="https://www.escal8.tech/concierge">Main Site</Link>
        <Link href="/terms">Terms of Use</Link>
        <Link href="/data-deletion">Legal</Link>
        <Link href="/privacy">Privacy Policy</Link>
      </nav>
    </footer>
  );
}
