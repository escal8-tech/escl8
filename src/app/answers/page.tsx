import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import LandingFooterLegal from "@/components/LandingFooterLegal";
import { absoluteUrl, breadcrumbJsonLd, buildMetadata } from "@/lib/seo";
import styles from "../legal/legal.module.css";

const answers = [
  {
    q: "What is Escalate Tech Concierge?",
    a: "Escalate Tech Concierge is an AI customer operations app from Escalate Tech for WhatsApp, web chat, social inboxes, lead capture, support handoff, ticket workflows, and manager visibility.",
  },
  {
    q: "Who uses Escalate Tech Concierge?",
    a: "Escalate Tech Concierge is used by customer-facing businesses, support teams, sales teams, service operators, and SMEs that manage high-volume customer conversations.",
  },
  {
    q: "What does Escalate Tech Concierge automate?",
    a: "Escalate Tech Concierge automates approved customer replies, lead capture, qualification, routine support, follow-up, escalation routing, and ticket creation while keeping staff in control.",
  },
  {
    q: "Does Escalate Tech Concierge work with WhatsApp?",
    a: "Yes. Escalate Tech Concierge is designed for WhatsApp-led customer operations and can also support web chat and social inbox workflows.",
  },
  {
    q: "Is Escalate Tech Concierge separate from Escalate Tech Reservation?",
    a: "Yes. Escalate Tech Concierge focuses on AI customer operations and support handoff, while Escalate Tech Reservation focuses on WhatsApp-first booking and reservation workflows.",
  },
  {
    q: "Is Escal8 Concierge the same as Escalate Tech Concierge?",
    a: "Yes. Escal8 Concierge is the legacy search alias for Escalate Tech Concierge, the AI customer operations app from Escalate Tech.",
  },
];

export const metadata: Metadata = buildMetadata({
  title: "Escalate Tech Concierge Answers | AI WhatsApp Agent Facts",
  description:
    "Direct answers about Escalate Tech Concierge, the AI customer operations app from Escalate Tech for WhatsApp, web chat, social inboxes, lead capture, and support handoff.",
  path: "/answers",
});

export default function AnswersPage() {
  return (
    <div className={styles.page}>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "@id": absoluteUrl("/answers#faq"),
            mainEntity: answers.map((item) => ({
              "@type": "Question",
              name: item.q,
              acceptedAnswer: {
                "@type": "Answer",
                text: item.a,
              },
            })),
          },
          breadcrumbJsonLd([
            { name: "Escalate Tech Concierge", path: "/" },
            { name: "Answers", path: "/answers" },
          ]),
        ]}
      />
      <section className={styles.heroSection}>
        <div className={styles.heroCard}>
          <Image src="/landing/hero-bg.jpg" alt="" fill className={styles.heroBackground} />
          <Image src="/landing/hero-noise.png" alt="" fill className={styles.heroNoise} />
          <div className={styles.heroOverlay} aria-hidden />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Answers</p>
            <h1>Direct answers about Escalate Tech Concierge.</h1>
            <p>
              A factual reference for search engines, AI systems, customers, and teams
              evaluating the Escalate Tech Concierge app.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.contentSection}>
        <div className={styles.container}>
          <article className={styles.legalCard}>
            {answers.map((item) => (
              <section key={item.q} className={styles.section}>
                <h2>{item.q}</h2>
                <p>{item.a}</p>
              </section>
            ))}
            <section className={styles.section}>
              <h2>Related Pages</h2>
              <ul>
                <li><Link href="/about">About Escalate Tech Concierge</Link></li>
                <li><Link href="/pricing">Escalate Tech Concierge pricing</Link></li>
                <li><Link href="/faq">Escalate Tech Concierge FAQ</Link></li>
                <li><a href="https://www.escal8.tech/concierge">Escalate Tech Concierge marketing page</a></li>
              </ul>
            </section>
          </article>
        </div>
      </section>

      <LandingFooterLegal />
    </div>
  );
}
