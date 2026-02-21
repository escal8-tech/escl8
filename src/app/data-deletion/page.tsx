import type { Metadata } from "next";
import Image from "next/image";
import LandingFooterLegal from "@/components/LandingFooterLegal";
import styles from "../legal/legal.module.css";

export const metadata: Metadata = {
  title: "User Data Deletion - Escl8",
};

export default function DataDeletionPage() {
  return (
    <div className={styles.page}>
      <section className={styles.heroSection}>
        <div className={styles.heroCard}>
          <Image src="/landing/hero-bg.jpg" alt="" fill className={styles.heroBackground} />
          <Image src="/landing/hero-noise.png" alt="" fill className={styles.heroNoise} />
          <div className={styles.heroOverlay} aria-hidden />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Legal</p>
            <h1>User Data Deletion</h1>
            <p>
              You can request deletion of your personal data or end-user
              conversation data processed by Escl8.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.contentSection}>
        <div className={styles.container}>
          <article className={styles.legalCard}>
            <section className={styles.section}>
              <h2>Request Methods</h2>
              <ul>
                <li>
                  Email: <a href="mailto:privacy@escl8.com">privacy@escl8.com</a>
                </li>
                <li>Subject line: <em>Data Deletion Request</em></li>
                <li>
                  Include the account email, company name, and (if applicable)
                  conversation identifiers, phone numbers, or date ranges.
                </li>
              </ul>
            </section>

            <section className={styles.section}>
              <h2>What We Delete</h2>
              <ul>
                <li>Account data upon account closure (subject to legal retention).</li>
                <li>Uploaded documents and derived indexes (on request).</li>
                <li>End-user conversation logs associated with your workspace (on request).</li>
              </ul>
            </section>

            <section className={styles.section}>
              <h2>Timelines</h2>
              <p>
                We aim to confirm your request within 7 days and complete deletion
                within 30 days, unless a longer period is required by law or
                reasonably necessary to fulfill legal obligations or resolve disputes.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Verification</h2>
              <p>
                We may require reasonable verification of your identity and
                authorization before processing deletion requests.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Platform-Specific Instructions</h2>
              <p>
                For WhatsApp users interacting with AI agents operated by our
                customers, please contact the business directly or email us with
                the phone number and conversation details so we can coordinate
                deletion with the appropriate customer controller.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Contact</h2>
              <p>
                For deletion support, email{" "}
                <a href="mailto:privacy@escl8.com">privacy@escl8.com</a>.
              </p>
            </section>
          </article>
        </div>
      </section>

      <LandingFooterLegal />
    </div>
  );
}
