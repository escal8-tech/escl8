/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";

import {
  formatTrackingMoney,
  getPublicOrderTrackingData,
} from "@/server/services/orderTracking";
import { parseMoneyNumber } from "@/lib/money";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown, fallback = "-"): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function asNumber(value: unknown): number {
  return parseMoneyNumber(value) ?? 0;
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function orderRef(orderId: string): string {
  return cleanText(orderId, "ORDER").slice(0, 8).toUpperCase();
}

function toneClass(tone: "done" | "current" | "pending" | "issue"): string {
  if (tone === "done") return styles.dotDone;
  if (tone === "current") return styles.dotCurrent;
  if (tone === "issue") return styles.dotIssue;
  return styles.dotPending;
}

function stepClass(tone: "done" | "current" | "pending" | "issue"): string {
  if (tone === "done") return styles.stepDone;
  if (tone === "current") return styles.stepCurrent;
  if (tone === "issue") return styles.stepIssue;
  return styles.stepPending;
}

function statusLabel(status: string | null | undefined): string {
  return cleanText(status, "Pending").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function isDeliveryFeeItem(value: unknown): boolean {
  const label = cleanText(value, "").toLowerCase();
  return /^(delivery|delivery fee|shipping|shipping fee|courier|courier fee)$/.test(label);
}

function MissingTrackingPage() {
  return (
    <main className={styles.page}>
      <section className={styles.empty}>
        <h1>Order tracking unavailable</h1>
        <p>This order link is invalid or has expired. Please contact the business if you need help with the order.</p>
      </section>
    </main>
  );
}

export default async function PublicOrderTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getPublicOrderTrackingData(token);
  if (!data) return <MissingTrackingPage />;

  const { order, business, items, timeline } = data;
  const publicRef = cleanText(order.paymentReference).replace(/^ORD[-_\s]*/i, "") || orderRef(order.id);
  const primary = business.primaryColor || "#0E1B40";
  const secondary = business.secondaryColor || "#D4A457";
  const pageStyle = {
    "--brand-primary": primary,
    "--brand-secondary": secondary,
  } as CSSProperties & Record<string, string>;
  const total = asNumber(order.expectedAmount ?? order.paidAmount)
    || items.reduce((sum, item) => {
      const quantity = Math.max(1, asNumber(item.quantity || 1));
      const lineTotal = asNumber(item.lineTotal);
      const unitPrice = asNumber(item.unitPrice);
      return sum + (lineTotal || unitPrice * quantity);
    }, 0);
  const logoStyle: CSSProperties = { background: primary };
  const contactLine = [business.address, business.phone, business.email, business.website].filter(Boolean).join(" | ");
  const deliveryMode = cleanText(order.shippingAddress).toLowerCase() === "pickup"
    || cleanText(order.deliveryArea).toLowerCase() === "pickup"
    || cleanText(order.deliveryNotes).toLowerCase().includes("[pickup]")
    ? "Pickup"
    : "Delivery";
  const currentStep = timeline.find((item) => item.tone === "current") ?? timeline.find((item) => item.tone === "issue") ?? timeline[timeline.length - 1];
  const completedSteps = timeline.filter((item) => item.tone === "done").length;
  const progress = Math.max(12, Math.min(100, Math.round((completedSteps / Math.max(1, timeline.length)) * 100)));
  const deliveryFeeItems = items.filter((item) => isDeliveryFeeItem(item.item));
  const productItems = items.filter((item) => !isDeliveryFeeItem(item.item));
  const deliveryFee = deliveryFeeItems.reduce((sum, item) => {
    const quantity = Math.max(1, asNumber(item.quantity || 1));
    const lineTotal = asNumber(item.lineTotal);
    const unitPrice = asNumber(item.unitPrice);
    return sum + (lineTotal || unitPrice * quantity);
  }, 0);

  return (
    <main className={styles.page} style={pageStyle}>
      <div className={styles.shell}>
        <header className={styles.brandBar}>
          <div className={styles.brand}>
            {business.logoUrl ? (
              <img className={styles.logo} src={business.logoUrl} alt={`${business.name} logo`} />
            ) : (
              <div className={styles.logoFallback} style={logoStyle} aria-hidden="true">
                {business.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className={styles.businessName}>{business.name}</h1>
              {contactLine ? <p className={styles.businessMeta}>{contactLine}</p> : null}
            </div>
          </div>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroTop}>
            <div>
              <p className={styles.eyebrow}>Order tracking</p>
              <h2 className={styles.title}>Order #{publicRef}</h2>
              <p className={styles.subtitle}>
                {currentStep?.label ? `${currentStep.label}. ` : ""}Your live order status appears here as the team processes it.
              </p>
            </div>
            <div className={styles.statusPill}>
              {statusLabel(order.status)}
            </div>
          </div>
          <div className={styles.progressWrap} aria-label={`Order progress ${progress}%`}>
            <div className={styles.progressMeta}>
              <span>Progress</span>
              <strong>{completedSteps}/{timeline.length}</strong>
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <p className={styles.label}>Total</p>
              <p className={styles.value}>{formatTrackingMoney(order.currency, total)}</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.label}>Payment ref</p>
              <p className={styles.value}>{cleanText(order.paymentReference)}</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.label}>Method</p>
              <p className={styles.value}>{deliveryMode}</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.label}>Last update</p>
              <p className={styles.value}>{formatDate(order.updatedAt)}</p>
            </div>
          </div>
        </section>

        <div className={styles.contentGrid}>
          <div>
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Order items</h3>
                <p className={styles.cardDescription}>Approved items and amounts captured for this order.</p>
              </div>
              <div className={styles.items}>
                {productItems.length ? (
                  productItems.map((item, index) => {
                    const quantity = Math.max(1, asNumber(item.quantity || 1));
                    const lineTotal = asNumber(item.lineTotal);
                    const unitPrice = asNumber(item.unitPrice);
                    const amount = lineTotal || unitPrice * quantity;
                    return (
                      <div className={styles.itemRow} key={`${item.item}-${index}`}>
                        <div>
                          <div className={styles.itemName}>{cleanText(item.item, "Order item")}</div>
                          <div className={styles.itemMeta}>Unit: {unitPrice ? formatTrackingMoney(order.currency, unitPrice) : "-"}</div>
                        </div>
                        <div className={styles.itemMeta}>x{quantity}</div>
                        <div className={styles.amount}>{formatTrackingMoney(order.currency, amount)}</div>
                      </div>
                    );
                  })
                ) : (
                  <p className={styles.mutedValue}>No item breakdown is available for this order.</p>
                )}
                {deliveryFeeItems.length ? (
                  <div className={styles.feeRow}>
                    <div>
                      <p className={styles.feeLabel}>Delivery fee</p>
                      <p className={styles.feeMeta}>
                        {deliveryFee > 0 ? "Added to this order at checkout." : "Free delivery was applied to this order."}
                      </p>
                    </div>
                    <div className={styles.feeAmount}>
                      {deliveryFee > 0 ? formatTrackingMoney(order.currency, deliveryFee) : "Free"}
                    </div>
                  </div>
                ) : null}
                <div className={styles.totalRow}>
                  <div>
                    <p className={styles.label}>Order total</p>
                    <p className={styles.mutedValue}>Includes any delivery fee captured at checkout.</p>
                  </div>
                  <div className={styles.totalAmount}>{formatTrackingMoney(order.currency, total)}</div>
                </div>
              </div>
            </section>

            <section className={styles.card} style={{ marginTop: 18 }}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Customer</h3>
                <p className={styles.cardDescription}>Only non-sensitive order identity is shown on this public page.</p>
              </div>
              <div className={styles.detailsGrid}>
                <div className={styles.detailBox}>
                  <p className={styles.label}>Name</p>
                  <p className={styles.value}>{cleanText(order.recipientName || order.customerName)}</p>
                </div>
              </div>
            </section>
          </div>

          <aside className={styles.card}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>Timeline</h3>
              <p className={styles.cardDescription}>Payment and fulfillment progress.</p>
            </div>
            <div className={styles.stepStrip}>
              {timeline.map((item, index) => (
                <div className={`${styles.stepChip} ${stepClass(item.tone)}`} key={`chip-${item.key}`} title={item.label}>
                  {index + 1}
                </div>
              ))}
            </div>
            <div className={styles.timeline}>
              {timeline.map((item) => (
                <div className={styles.timelineItem} key={item.key}>
                  <div className={`${styles.dot} ${toneClass(item.tone)}`} aria-hidden="true" />
                  <div>
                    <p className={styles.timelineLabel}>{item.label}</p>
                    <p className={styles.timelineDescription}>{item.description}</p>
                    <p className={styles.timelineAt}>{formatDate(item.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <footer className={styles.poweredFooter}>
          <a className={styles.poweredLink} href="https://www.escal8.tech" target="_blank" rel="noreferrer">
            <img className={styles.poweredLogo} src="/landing/nav-infinity-crop.png" alt="" aria-hidden="true" />
            <span>by Escal8</span>
          </a>
        </footer>
      </div>
    </main>
  );
}
