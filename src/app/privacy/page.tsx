import type { Metadata } from "next";
import Image from "next/image";
import LandingFooterLegal from "@/components/LandingFooterLegal";
import styles from "../legal/legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy - Escl8",
};

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <section className={styles.heroSection}>
        <div className={styles.heroCard}>
          <Image src="/landing/hero-bg.jpg" alt="" fill className={styles.heroBackground} />
          <Image src="/landing/hero-noise.png" alt="" fill className={styles.heroNoise} />
          <div className={styles.heroOverlay} aria-hidden />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Legal</p>
            <h1>Privacy Policy</h1>
            <p>
              How Escl8 collects, uses, and safeguards data when you operate AI
              conversations across WhatsApp and web channels.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.contentSection}>
        <div className={styles.container}>
          <article className={styles.legalCard}>
            <p className={styles.updated}>Last updated: {new Date().toLocaleDateString()}</p>

            <section className={styles.section}>
              <p>
                This Privacy Policy explains how <strong>Escl8</strong> (&quot;we&quot;,
                &quot;us&quot;, or &quot;our&quot;) collects, uses, and protects information when you use our
                services to create and operate customized AI agents for WhatsApp and
                web channels.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Information We Collect</h2>
              <ul className={styles.flushList}>
                <li>
                  Business content you provide (e.g., documents, PDFs, knowledge
                  base exports, prompts, and configuration).
                </li>
                <li>
                  Account and billing details (e.g., email, company name,
                  subscription info).
                </li>
                <li>
                  Usage data and logs (e.g., requests, responses, timestamps,
                  device info).
                </li>
                <li>
                  End-user conversation data processed on your behalf when
                  interacting with your AI agent via WhatsApp or web.
                </li>
              </ul>
            </section>

            <section className={styles.section}>
              <h2>How We Use Information</h2>
              <p>
                We use the information to provide and improve our services,
                including: (i) indexing your documents for retrieval; (ii)
                generating responses in your defined tone; (iii) enforcing safety
                and usage limits; and (iv) analytics to help you measure
                performance. We do not sell personal data.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Data Processing On Your Behalf</h2>
              <p>
                For end-user conversations, we act as a processor, processing data
                on your instructions. You are responsible for obtaining necessary
                permissions and providing notices to your end users.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Retention</h2>
              <p>
                We retain account data for the duration of your account and as
                required by law. Conversation logs and uploaded content are
                retained as long as needed to provide the service and can be
                deleted upon request or via your account controls when available.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Security</h2>
              <p>
                We implement technical and organizational safeguards appropriate to
                the risk. No method of transmission or storage is 100% secure; we
                cannot guarantee absolute security.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Third Parties</h2>
              <p>
                We may use third-party processors (e.g., hosting providers,
                NLP/LLM infrastructure, WhatsApp Business API providers) to
                deliver the service. These providers are bound by contractual
                obligations and may change over time.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Your Rights</h2>
              <p>
                Depending on your location, you may have rights to access, correct,
                delete, or port your personal data, or object to certain
                processing. To exercise rights, see the Data Deletion page or
                contact us.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Children</h2>
              <p>
                Our services are not directed to children under 13 (or the
                applicable age of consent). We do not knowingly collect data from
                children.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Changes</h2>
              <p>
                We may update this Policy from time to time. Material changes will
                be posted here with an updated date.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Contact</h2>
              <p>
                For privacy inquiries, email{" "}
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
