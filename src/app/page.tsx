import Image from "next/image";
import Link from "next/link";
import { Inter, Inter_Tight } from "next/font/google";
import { Fragment } from "react";
import styles from "./page.module.css";
import TestimonialCarousel from "./TestimonialCarousel";

const inter = Inter({
  subsets: ["latin"],
  variable: "--landing-inter",
  weight: ["400", "500", "600", "700"],
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--landing-inter-tight",
  weight: ["500", "600"],
});

const logos = ["GENERAL DYNAMICS", "HUMAN", "META", "CITI", "MICROSOFT"];

const stats = [
  { value: "24/7", label: "Instant AI responses, never miss a lead." },
  { value: "80%", label: "Reduce manual replies with smart automation." },
  { value: "10x", label: "Handle more conversations without hiring." },
  { value: "20%", label: "Increase conversions from every chat." },
];

const faqs = [
  {
    question: "How does ESCL8 use AI?",
    answer:
      "ESCL8 uses AI to automate replies, qualify leads, and route conversations across channels so your team can focus on high-value interactions.",
  },
  {
    question: "How long does it take to get started?",
    answer:
      "Most teams are live in a few days. We connect your channels, train your assistant on your materials, then calibrate tone and workflows.",
  },
  {
    question: "Can ESCL8 work with my existing CRM?",
    answer:
      "Yes. ESCL8 is designed to plug into existing systems so contacts, conversation context, and outcomes sync into your current workflow.",
  },
  {
    question: "Is my customer data safe?",
    answer:
      "Security and privacy controls are built in, including access controls, data handling guardrails, and audit-friendly workflow design.",
  },
  {
    question: "Do AI chatbots sound human?",
    answer:
      "With brand-specific training, guardrails, and continuous tuning, ESCL8 responses are designed to sound natural and consistent with your voice.",
  },
];

const socialLinks = [
  { label: "Instagram", href: "#", icon: "/landing/contact-instagram.svg" },
  { label: "Facebook", href: "#", icon: "/landing/contact-facebook.svg" },
  { label: "Twitter", href: "#", icon: "/landing/contact-twitter.svg" },
  { label: "YouTube", href: "#", icon: "/landing/contact-youtube.svg" },
  { label: "LinkedIn", href: "#", icon: "/landing/contact-linkedin.svg" },
];

export default function Home() {
  const statCardClasses = [
    styles.statCardOne,
    styles.statCardTwo,
    styles.statCardThree,
    styles.statCardFour,
  ];

  return (
    <div className={`${styles.page} ${inter.variable} ${interTight.variable}`}>
      <section className={styles.heroSection}>
        <div className={styles.heroStack}>
          <div className={styles.heroCard}>
            <Image
              src="/landing/hero-bg.jpg"
              alt=""
              fill
              priority
              className={styles.heroBackground}
            />
            <Image
              src="/landing/hero-noise.png"
              alt=""
              fill
              priority
              className={styles.heroNoise}
            />
            <div className={styles.heroOverlay} aria-hidden />

            <header className={styles.heroNav}>
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

            <div className={styles.heroContent}>
              <div className={styles.heroCopy}>
                <h1>
                  AI-Driven Conversations, Insights
                  <br />
                  &amp; Sales, All in One Platform
                </h1>
                <p>
                  Train on your docs. Set your brand tone. Launch a revenue-driving AI
                  sales agent where your customers already are.
                </p>
              </div>
              <div className={styles.heroActions}>
                <Link href="/portal" className={styles.primaryButton}>
                  Start Free Trial
                </Link>
                <Link href="#contact" className={styles.secondaryButton}>
                  Get a Demo
                </Link>
              </div>
            </div>
          </div>

          <div className={styles.heroDashboardWrap}>
            <div className={styles.heroDashboard}>
              <Image
                src="/landing/hero-dashboard-shadow.png"
                alt=""
                fill
                className={styles.heroDashboardShadow}
              />
              <Image
                src="/landing/hero-dashboard.png"
                alt="Escal8 dashboard preview"
                fill
                className={styles.heroDashboardImage}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.logoStrip}>
        <div className={styles.container}>
          <ul className={styles.logoList}>
            {logos.map((logo) => (
              <li key={logo}>{logo}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Features</p>
            <h2>Everything You Need to Run Smarter Conversations</h2>
            <p className={styles.sectionDescription}>
              Unify all your channels into one inbox and let AI handle thousands of
              conversations automatically, so your team can focus on closing deals.
            </p>
          </header>

          <div className={styles.featuresGrid}>
            <article className={styles.featureCard}>
              <div className={styles.featureVisualOne}>
                <Image
                  src="/landing/inbox.png"
                  alt="Unified inbox channels visualization"
                  width={522}
                  height={375}
                  className={styles.featureVisualImage}
                />
              </div>
              <div className={styles.featureText}>
                <h3>One inbox for all your channels</h3>
                <p>
                  Connect WhatsApp, Instagram, Telegram, Shopee, Lazada, and more, and
                  manage all customer conversations from a single platform.
                </p>
              </div>
            </article>

            <article className={styles.featureCard}>
              <div className={styles.featureVisualTwo}>
                <Image
                  src="/landing/conversation.png"
                  alt="Multiple customers, one chatbot visualization"
                  width={522}
                  height={375}
                  className={styles.featureVisualImage}
                />
              </div>
              <div className={styles.featureText}>
                <h3>Handle conversations automatically</h3>
                <p>
                  Our chatbot can handle thousands of customer conversations at the same
                  time, so your team doesn&apos;t need to reply manually to every message.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Why us</p>
            <h2>Why teams choose Escl8?</h2>
            <p className={styles.sectionDescription}>
              Because modern businesses need AI that feels human, works across every
              channel, and drives real results &mdash; without adding more tools or
              manual work.
            </p>
          </header>

          <div className={styles.whyPanel}>
            <Image
              src="/landing/why-bg.png"
              alt=""
              fill
              className={styles.whyPanelBackground}
            />
            <article className={styles.whyItem}>
              <div className={styles.whyIconBox}>
                <Image
                  src="/landing/why-icon-profile.svg"
                  alt=""
                  width={24}
                  height={24}
                  className={styles.whyIconImage}
                />
              </div>
              <h3>AI that sounds real.</h3>
              <p>
                Escal8&apos;s AI isn&apos;t just automated &mdash; it replies in your
                brand tone, answers real questions intelligently, and keeps conversations
                flowing like a person would &mdash; across WhatsApp, web chat, and more.
              </p>
            </article>
            <article className={styles.whyItem}>
              <div className={styles.whyIconBox}>
                <Image
                  src="/landing/why-icon-messages.svg"
                  alt=""
                  width={24}
                  height={24}
                  className={styles.whyIconImage}
                />
              </div>
              <h3>All your chats in one view</h3>
              <p>
                Stop switching between apps. See every message, customer thread, and AI
                response from one intelligent inbox &mdash; with filters, searchable
                history, and seamless human takeover when needed.
              </p>
            </article>
            <article className={styles.whyItem}>
              <div className={styles.whyIconBox}>
                <Image
                  src="/landing/why-icon-eye.svg"
                  alt=""
                  width={24}
                  height={24}
                  className={styles.whyIconImage}
                />
              </div>
              <h3>AI insights that drive action</h3>
              <p>
                Turn every conversation into intelligence. Know buyer intent, lead
                quality, engagement patterns, and performance metrics &mdash; so you can
                optimize offers, focus teams, and grow revenue
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Value Proposition</p>
            <h2>Real impact for growing teams</h2>
            <p className={styles.sectionDescription}>
              See how Escal8 helps businesses respond faster, automate smarter, and
              convert more conversations
              <br />
              into revenue &mdash; every single day.
            </p>
          </header>
          <div className={styles.statsGrid}>
            {stats.map((item, index) => (
              <Fragment key={item.value}>
                <article className={`${styles.statCard} ${statCardClasses[index]}`}>
                  <p>{item.value}</p>
                  <span>{item.label}</span>
                </article>
                {index < stats.length - 1 ? (
                  <span className={styles.statSeparator} aria-hidden />
                ) : null}
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Testimonials</p>
            <h2>Trusted by fast-growing teams</h2>
            <p className={styles.sectionDescription}>
              Real stories from businesses using Escal8 to automate conversations, capture
              more leads,
              <br />
              and scale support with confidence.
            </p>
          </header>

          <TestimonialCarousel />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>FAQ</p>
            <h2>Got questions? We&apos;ve got answers</h2>
            <p className={styles.sectionDescription}>
              Everything teams ask before launching Escal8, pricing, setup, and data safety.
            </p>
          </header>
          <div className={styles.faqList}>
            {faqs.map((item, index) => (
              <details key={item.question} className={styles.faqItem} open={index === 0}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className={styles.section}>
        <div className={styles.container}>
          <div className={styles.contactGrid}>
            <div className={styles.contactIntro}>
              <p className={styles.eyebrow}>Contact Us</p>
              <h2>Let&apos;s get started</h2>
              <p className={styles.contactDescription}>
                Have questions or want to learn more? Our team is here to help, and
                we&apos;ll get back to you shortly.
              </p>
              <div className={styles.socialRow}>
                {socialLinks.map((item) => (
                  <a key={item.label} href={item.href} aria-label={item.label}>
                    <Image
                      src={item.icon}
                      alt=""
                      width={20}
                      height={20}
                      className={styles.socialIcon}
                    />
                  </a>
                ))}
              </div>
            </div>

            <form className={styles.contactForm}>
              <div className={styles.contactFields}>
                <label className={styles.contactField}>
                  <span>Name</span>
                  <input
                    className={styles.contactInput}
                    type="text"
                    name="name"
                    autoComplete="name"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    data-ms-editor="false"
                  />
                </label>
                <label className={styles.contactField}>
                  <span>Email Address</span>
                  <input
                    className={styles.contactInput}
                    type="email"
                    name="email"
                    autoComplete="email"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    data-ms-editor="false"
                  />
                </label>
                <label className={`${styles.contactField} ${styles.contactFieldMessage}`}>
                  <span>Message</span>
                  <textarea
                    className={styles.contactInput}
                    name="message"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    data-ms-editor="false"
                  />
                </label>
              </div>
              <button type="button" className={styles.contactSubmit}>
                Submit
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className={styles.footerCtaSection}>
        <div className={styles.footerCta}>
          <div className={styles.footerCtaDecoration} aria-hidden>
            <Image
              src="/landing/footer-cta-orbit.png"
              alt=""
              width={858}
              height={400}
              className={styles.footerCtaDecorationImage}
            />
          </div>
          <div className={styles.footerCtaContent}>
            <div className={styles.footerCtaHeader}>
              <div className={styles.footerCtaHeading}>
                <p className={styles.eyebrowLight}>All-in-one AI conversation platform</p>
                <h2 className={styles.footerCtaTitle}>
                  Turn more conversations into customers
                </h2>
              </div>
              <p className={styles.footerDescription}>
                Automate replies, capture leads, and manage every channel from one i
                <br />
                ntelligent inbox &mdash; without hiring more agents.
              </p>
            </div>
            <Link href="/portal" className={styles.footerCtaButton}>
              Start Free Trial
            </Link>
          </div>
        </div>

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
      </section>
    </div>
  );
}

