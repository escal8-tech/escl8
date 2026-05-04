import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Inter, Inter_Tight } from "next/font/google";
import styles from "./faq.module.css";
import LandingFooterLegal from "@/components/LandingFooterLegal";
import JsonLd from "@/components/JsonLd";
import { absoluteUrl, breadcrumbJsonLd, buildMetadata } from "@/lib/seo";

const inter = Inter({
  subsets: ["latin"],
  variable: "--faq-inter",
  weight: ["400", "500", "600", "700"],
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--faq-inter-tight",
  weight: ["500", "600"],
});

const faqGroups = [
  {
    title: "Getting Started",
    items: [
      {
        q: "How quickly can I deploy my first AI concierge?",
        a: "Most teams can launch once source content, brand voice, channel setup, and escalation rules are configured.",
      },
      {
        q: "What documents can I use to train the AI?",
        a: "You can use product catalogs, FAQs, policy docs, price sheets, and knowledge-base content.",
      },
      {
        q: "Is there a free trial?",
        a: "Yes. Every plan includes a 14-day free trial with full platform access.",
      },
    ],
  },
  {
    title: "AI and Accuracy",
    items: [
      {
        q: "How accurate are responses?",
        a: "With proper training data, the assistant stays grounded in your content and brand guidelines.",
      },
      {
        q: "What if the AI does not know an answer?",
        a: "You can define fallback behavior: ask follow-up questions, create a lead, or escalate to a human.",
      },
      {
        q: "Can it keep our brand voice consistent?",
        a: "Yes. Tone, phrasing, and response boundaries are configurable so replies stay aligned with your brand.",
      },
    ],
  },
  {
    title: "Security and Billing",
    items: [
      {
        q: "How is customer data protected?",
        a: "Data is encrypted in transit and at rest with access controls designed for business use.",
      },
      {
        q: "Can I change my plan later?",
        a: "Yes. You can upgrade or downgrade as your volume and workflow needs evolve.",
      },
      {
        q: "Do you offer annual discounts?",
        a: "Yes. Annual billing offers a lower effective monthly rate compared to monthly billing.",
      },
    ],
  },
];

const faqItems = faqGroups.flatMap((group) => group.items);

export const metadata: Metadata = buildMetadata({
  title: "Escalate Tech Concierge FAQ | AI WhatsApp Agent Answers",
  description:
    "Answers about Escalate Tech Concierge, AI WhatsApp agents, customer operations automation, support handoff, billing, accuracy, and setup.",
  path: "/faq",
});

export default function FAQPage() {
  return (
    <div className={`${styles.page} ${inter.variable} ${interTight.variable}`}>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "@id": absoluteUrl("/faq#faq"),
            mainEntity: faqItems.map((item) => ({
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
            { name: "FAQ", path: "/faq" },
          ]),
        ]}
      />
      <section className={styles.heroSection}>
        <div className={styles.heroCard}>
          <Image src="/landing/hero-bg.jpg" alt="" fill className={styles.heroBackground} />
          <Image src="/landing/hero-noise.png" alt="" fill className={styles.heroNoise} />
          <div className={styles.heroOverlay} aria-hidden />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Support</p>
            <h1>Frequently Asked Questions</h1>
            <p>
              Everything you need to know about deploying AI concierge workflows
              that support customers and keep staff in control.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          {faqGroups.map((group) => (
            <div key={group.title} className={styles.group}>
              <h2>{group.title}</h2>
              <div className={styles.items}>
                {group.items.map((item, index) => (
                  <details key={item.q} className={styles.faqItem} open={index === 0}>
                    <summary>
                      <span>{item.q}</span>
                      <span className={styles.chevron} aria-hidden />
                    </summary>
                    <p>{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.ctaCard}>
            <p className={styles.eyebrow}>Still Have Questions?</p>
            <h2>We can walk you through your exact use case</h2>
            <p>
              Talk to the team to review setup, integrations, and what your rollout
              would look like.
            </p>
            <div className={styles.ctaActions}>
              <Link href="/#contact" className={styles.ctaPrimary}>
                Contact Us
              </Link>
              <Link href="/pricing" className={styles.ctaSecondary}>
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      <LandingFooterLegal />
    </div>
  );
}
