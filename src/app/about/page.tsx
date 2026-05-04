import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import LandingFooterLegal from "@/components/LandingFooterLegal";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  buildMetadata,
  conciergeSeo,
  conciergeSoftwareJsonLd,
  organizationJsonLd,
} from "@/lib/seo";
import styles from "../legal/legal.module.css";

export const metadata: Metadata = buildMetadata({
  title: "About Escalate Tech Concierge | AI Customer Operations App",
  description: conciergeSeo.standardDescription,
  path: "/about",
});

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <JsonLd
        data={[
          organizationJsonLd(),
          conciergeSoftwareJsonLd(),
          breadcrumbJsonLd([
            { name: "Escalate Tech Concierge", path: "/" },
            { name: "About", path: "/about" },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "AboutPage",
            "@id": absoluteUrl("/about#about"),
            name: "About Escalate Tech Concierge",
            url: absoluteUrl("/about"),
            mainEntity: {
              "@id": absoluteUrl("/#software"),
            },
          },
        ]}
      />
      <section className={styles.heroSection}>
        <div className={styles.heroCard}>
          <Image src="/landing/hero-bg.jpg" alt="" fill className={styles.heroBackground} />
          <Image src="/landing/hero-noise.png" alt="" fill className={styles.heroNoise} />
          <div className={styles.heroOverlay} aria-hidden />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>About</p>
            <h1>Escalate Tech Concierge is the AI customer operations app from Escalate Tech.</h1>
            <p>{conciergeSeo.standardDescription}</p>
          </div>
        </div>
      </section>

      <section className={styles.contentSection}>
        <div className={styles.container}>
          <article className={styles.legalCard}>
            <section className={styles.section}>
              <h2>Neutral Description</h2>
              <p>
                Escalate Tech Concierge is an AI customer operations app from Escalate Tech for
                WhatsApp, web chat, social inboxes, lead capture, support handoff,
                ticket workflows, and manager visibility. It is built for
                customer-facing businesses that need faster responses without losing
                staff control.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Core Capabilities</h2>
              <ul>
                <li>AI replies grounded in approved business content and brand tone.</li>
                <li>WhatsApp, web chat, and social inbox customer conversations.</li>
                <li>Lead capture, qualification, follow-up, and human takeover.</li>
                <li>Ticket workflows for support, payment, order, and escalation moments.</li>
                <li>Manager visibility across conversations, queue status, and handoff points.</li>
              </ul>
            </section>

            <section className={styles.section}>
              <h2>Relationship to Escalate Tech</h2>
              <p>
                Escalate Tech Concierge is part of the Escalate Tech product suite. The main Escalate Tech
                website is <a href={conciergeSeo.mainSiteUrl}>{conciergeSeo.mainSiteUrl}</a>,
                and the primary product page is{" "}
                <a href={conciergeSeo.mainProductUrl}>{conciergeSeo.mainProductUrl}</a>. Escal8
                Concierge is the legacy search alias for this app.
              </p>
            </section>

            <section className={styles.section}>
              <h2>Important Links</h2>
              <ul>
                <li><Link href="/">Escalate Tech Concierge app login</Link></li>
                <li><Link href="/pricing">Escalate Tech Concierge pricing</Link></li>
                <li><Link href="/faq">Escalate Tech Concierge FAQ</Link></li>
                <li><Link href="/answers">Escalate Tech Concierge answers</Link></li>
                <li><Link href="/profiles">Official Escalate Tech profile links</Link></li>
              </ul>
            </section>
          </article>
        </div>
      </section>

      <LandingFooterLegal />
    </div>
  );
}
