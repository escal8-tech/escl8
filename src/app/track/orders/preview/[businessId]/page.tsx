/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";
import { eq } from "drizzle-orm";

import { businesses } from "../../../../../../drizzle/schema";
import { buildPrivateBlobReadUrl } from "@/lib/storage";
import { db } from "@/server/db/client";
import { getBusinessCustomizationSettingsRecord } from "@/server/services/businessSettingsStore";

import styles from "../../[token]/page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown, fallback = "-"): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

export default async function PublicOrderTrackingPreviewPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      settings: businesses.settings,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) {
    return (
      <main className={styles.page}>
        <section className={styles.empty}>
          <h1>Tracking preview unavailable</h1>
          <p>This workspace could not be loaded.</p>
        </section>
      </main>
    );
  }

  const customization = await getBusinessCustomizationSettingsRecord(businessId, business.settings);
  const businessName = cleanText(customization.businessName || business.name, "Business");
  const primary = cleanText(customization.primaryColor, "#0E1B40");
  const secondary = cleanText(customization.secondaryColor, "#D4A457");
  const logoUrl = customization.logoBlobPath
    ? buildPrivateBlobReadUrl(customization.logoBlobPath, 24 * 30, customization.logoContainer || undefined) || cleanText(customization.logoUrl, "")
    : cleanText(customization.logoUrl, "");

  return (
    <main
      className={styles.page}
      style={
        {
          "--brand-primary": primary,
          "--brand-secondary": secondary,
        } as CSSProperties & Record<string, string>
      }
    >
      <div className={styles.shell}>
        <header className={styles.brandBar}>
          <div className={styles.brand}>
            {logoUrl && logoUrl !== "-" ? (
              <img className={styles.logo} src={logoUrl} alt={`${businessName} logo`} />
            ) : (
              <div className={styles.logoFallback} style={{ background: primary }} aria-hidden="true">
                {businessName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className={styles.businessName}>{businessName}</h1>
              <p className={styles.businessMeta}>Preview of the branded order tracking page customers open from WhatsApp.</p>
            </div>
          </div>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroTop}>
            <div>
              <p className={styles.eyebrow}>Order tracking preview</p>
              <h2 className={styles.title}>Order #F8DEC23F</h2>
              <p className={styles.subtitle}>This sample page uses the current workspace branding and public tracking layout.</p>
            </div>
            <div className={styles.statusPill}>Payment Under Review</div>
          </div>
          <div className={styles.progressWrap} aria-label="Preview order progress 33%">
            <div className={styles.progressMeta}>
              <span>Progress</span>
              <strong>2/6</strong>
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: "33%" }} />
            </div>
          </div>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <p className={styles.label}>Total</p>
              <p className={styles.value}>LKR 36,300.00</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.label}>Payment ref</p>
              <p className={styles.value}>ORD-F8DEC23F</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.label}>Method</p>
              <p className={styles.value}>Delivery</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.label}>Last update</p>
              <p className={styles.value}>Today</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
