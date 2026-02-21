import Link from "next/link";
import Image from "next/image";
import { Inter, Inter_Tight } from "next/font/google";
import styles from "./pricing.module.css";
import LandingFooterLegal from "@/components/LandingFooterLegal";

const inter = Inter({
  subsets: ["latin"],
  variable: "--pricing-inter",
  weight: ["400", "500", "600", "700"],
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--pricing-inter-tight",
  weight: ["500", "600", "700"],
});

const plans = [
  {
    name: "Starter",
    subtitle: "Launch Fast",
    description:
      "Perfect for businesses ready to deploy AI-powered automation and start converting conversations into customers.",
    price: "RM250",
    cadence: "/month",
    cta: "Get Started Free",
    featured: false,
    notes: "14-day free trial - No credit card required",
    features: [
      "Unlimited document uploads",
      "Custom tone and brand voice",
      "Intelligent guardrails",
      "Basic conversation analytics",
      "Email support",
    ],
  },
  {
    name: "Growth",
    subtitle: "Scale Revenue",
    description:
      "For ambitious teams scaling multi-channel sales with advanced analytics, booking systems, and CRM workflows.",
    price: "RM500",
    cadence: "/month",
    cta: "Start Growth Plan",
    featured: true,
    notes: "",
    features: [
      "Everything in Starter",
      "Advanced analytics dashboard",
      "Intelligent booking calendar",
      "Built-in CRM and lead scoring",
      "Unified inbox",
      "Priority support",
    ],
  },
  {
    name: "Scale",
    subtitle: "Enterprise Power",
    description:
      "For high-volume organizations requiring deep integrations, custom workflows, and dedicated enterprise support.",
    price: "Custom",
    cadence: "",
    cta: "Talk to Sales",
    featured: false,
    notes: "Tailored to your exact requirements",
    features: [
      "Everything in Growth",
      "Custom API integrations",
      "Multi-brand management",
      "Custom data retention and SLA",
      "Dedicated solutions engineer",
      "24/7 priority support",
    ],
  },
];

const comparisonRows = [
  ["Document uploads", "Unlimited", "Unlimited", "Unlimited"],
  ["AI conversations / month", "10,000", "50,000", "Unlimited"],
  ["Brand voice customization", "No", "Yes", "Yes"],
  ["Analytics dashboard", "Basic", "Advanced", "Custom"],
  ["Booking calendar", "No", "Yes", "Yes"],
  ["CRM and lead scoring", "No", "Yes", "Yes"],
  ["Unified inbox", "No", "Yes", "Yes"],
  ["API access", "No", "Limited", "Full"],
  ["Support", "Email", "Priority", "24/7 Dedicated"],
];

export default function PricingPage() {
  return (
    <div className={`${styles.page} ${inter.variable} ${interTight.variable}`}>
      <section className={styles.heroSection}>
        <div className={styles.heroCard}>
          <Image src="/landing/hero-bg.jpg" alt="" fill className={styles.heroBackground} />
          <Image src="/landing/hero-noise.png" alt="" fill className={styles.heroNoise} />
          <div className={styles.heroOverlay} aria-hidden />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Transparent Pricing</p>
            <h1>Simple, Scalable Pricing for Every Stage of Growth</h1>
            <p>
              Start with powerful automation. Scale with enterprise capabilities.
              Pay only for what drives real revenue.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.planGrid}>
            {plans.map((plan) => (
              <article
                key={plan.name}
                className={`${styles.planCard} ${plan.featured ? styles.planCardFeatured : ""}`}
              >
                {plan.featured ? <span className={styles.featuredTag}>Most Popular</span> : null}
                <div className={styles.planHead}>
                  <p className={styles.planName}>{plan.name}</p>
                  <h2>{plan.subtitle}</h2>
                  <p className={styles.planDescription}>{plan.description}</p>
                </div>

                <ul className={styles.featureList}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

                <div className={styles.planFooter}>
                  <p className={styles.priceLine}>
                    {plan.price}
                    {plan.cadence ? <span>{plan.cadence}</span> : null}
                  </p>
                  <Link href={plan.name === "Scale" ? "/#contact" : "/portal"} className={styles.planButton}>
                    {plan.cta}
                  </Link>
                  {plan.notes ? <p className={styles.planNote}>{plan.notes}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Compare Plans</p>
            <h2>Everything You Need to Scale Conversations</h2>
          </header>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <colgroup>
                <col className={styles.featureCol} />
                <col className={styles.planCol} />
                <col className={styles.planCol} />
                <col className={styles.planCol} />
              </colgroup>
              <thead>
                <tr>
                  <th>Features</th>
                  <th>Starter</th>
                  <th>Growth</th>
                  <th>Scale</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row[0]}>
                    <td>{row[0]}</td>
                    <td>{row[1]}</td>
                    <td>{row[2]}</td>
                    <td>{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.ctaCard}>
            <p className={styles.eyebrow}>Need a Custom Plan?</p>
            <h2>Talk to our team about your growth goals</h2>
            <p>
              We can tailor onboarding, integrations, guardrails, and support to match
              your exact workflow.
            </p>
            <Link href="/#contact" className={styles.ctaButton}>
              Schedule a Demo
            </Link>
          </div>
        </div>
      </section>

      <LandingFooterLegal />
    </div>
  );
}
