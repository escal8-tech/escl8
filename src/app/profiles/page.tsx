import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import LandingFooterLegal from "@/components/LandingFooterLegal";
import { absoluteUrl, breadcrumbJsonLd, buildMetadata, conciergeSeo, organizationJsonLd } from "@/lib/seo";
import styles from "../legal/legal.module.css";

export const metadata: Metadata = buildMetadata({
  title: "Escalate Tech Concierge Profiles | Official Identity Links",
  description:
    "Official identity links for Escalate Tech Concierge and Escalate Tech across the app subdomain, main website, LinkedIn, Crunchbase, and Instagram.",
  path: "/profiles",
});

export default function ProfilesPage() {
  return (
    <div className={styles.page}>
      <JsonLd
        data={[
          organizationJsonLd(),
          breadcrumbJsonLd([
            { name: "Escalate Tech Concierge", path: "/" },
            { name: "Profiles", path: "/profiles" },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "@id": absoluteUrl("/profiles#profiles"),
            name: "Official Escalate Tech Concierge profile links",
            about: {
              "@id": "https://www.escal8.tech/#organization",
            },
            mainEntity: {
              "@type": "ItemList",
              itemListElement: conciergeSeo.sameAs.map((url, index) => ({
                "@type": "ListItem",
                position: index + 1,
                url,
              })),
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
            <p className={styles.eyebrow}>Profiles</p>
            <h1>Official Escalate Tech Concierge identity links.</h1>
            <p>
              These public links connect the Concierge app subdomain to the main
              Escalate Tech website and official Escalate Tech profiles.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.contentSection}>
        <div className={styles.container}>
          <article className={styles.legalCard}>
            <section className={styles.section}>
              <h2>Canonical Product Links</h2>
              <ul>
                <li><Link href="/">Escalate Tech Concierge app: {conciergeSeo.url}</Link></li>
                <li><a href={conciergeSeo.mainProductUrl}>Escalate Tech Concierge marketing page</a></li>
                <li><a href={conciergeSeo.mainSiteUrl}>Escalate Tech main website</a></li>
              </ul>
            </section>

            <section className={styles.section}>
              <h2>Official Escalate Tech Profiles</h2>
              <ul>
                <li><a href="https://www.linkedin.com/company/escal8concierge/">LinkedIn</a></li>
                <li><a href="https://www.crunchbase.com/organization/escal8">Crunchbase</a></li>
                <li><a href="https://www.instagram.com/escal8.tech/">Instagram</a></li>
              </ul>
            </section>

            <section className={styles.section}>
              <h2>Consistent Description</h2>
              <p>{conciergeSeo.standardDescription}</p>
              <p>Escal8 Concierge is the legacy search alias for Escalate Tech Concierge.</p>
            </section>
          </article>
        </div>
      </section>

      <LandingFooterLegal />
    </div>
  );
}
