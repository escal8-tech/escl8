"use client";

import { useEffect, useState } from "react";
import { WhatsAppEmbeddedSignupButton } from "@/components/WhatsAppEmbeddedSignup";
import { getFirebaseAuth } from "@/lib/firebaseClient";

/* ─────────────────────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────────────────────── */
const Icons = {
  check: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  link: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  clock: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
};

/* ─────────────────────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────────────────────── */
type CardKey = "whatsapp" | "telegram" | "shopee" | "lazada" | "tiktok" | "instagram";

type Card = {
  key: CardKey;
  name: string;
  desc: string;
  canSync: boolean;
  comingSoon: boolean;
  accent: string;
  tint: string;
  glyph: string;
  logoSrc?: string;
  logoSize?: number;
};

type SyncState = Record<CardKey, "idle" | "synced">;

/* ─────────────────────────────────────────────────────────────────────────────
   CARDS CONFIG
───────────────────────────────────────────────────────────────────────────── */
const cards: Card[] = [
  { key: "whatsapp", name: "WhatsApp", desc: "Connect WhatsApp Business for messaging and syncing.", canSync: true, comingSoon: false, accent: "#22c55e", tint: "rgba(34,197,94,0.10)", glyph: "WA", logoSrc: "/whatsapp.svg" },
  { key: "telegram", name: "Telegram", desc: "Sync Telegram bot conversations.", canSync: true, comingSoon: false, accent: "#229ed9", tint: "rgba(34,158,217,0.12)", glyph: "TG", logoSrc: "/telegram.png", logoSize: 51 },
  { key: "shopee", name: "Shopee", desc: "Sync orders and catalog from Shopee.", canSync: false, comingSoon: true, accent: "#f97316", tint: "rgba(249,115,22,0.08)", glyph: "SH", logoSrc: "/shopee.png", logoSize: 56 },
  { key: "lazada", name: "Lazada", desc: "Sync orders and catalog from Lazada.", canSync: false, comingSoon: true, accent: "#7c3aed", tint: "rgba(124,58,237,0.08)", glyph: "LZ", logoSrc: "/lazada.png" },
  { key: "tiktok", name: "TikTok Shop", desc: "Sync TikTok Shop orders and catalog.", canSync: false, comingSoon: true, accent: "#ec4899", tint: "rgba(236,72,153,0.08)", glyph: "TT" },
  { key: "instagram", name: "Instagram", desc: "Connect Instagram messaging.", canSync: false, comingSoon: true, accent: "#f472b6", tint: "rgba(244,114,182,0.10)", glyph: "IG" },
];

/* ─────────────────────────────────────────────────────────────────────────────
   STYLES
───────────────────────────────────────────────────────────────────────────── */
const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1400,
    margin: "0 auto",
    padding: "0 24px",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: "var(--foreground)",
    letterSpacing: "-0.025em",
  },
  subtitle: {
    color: "var(--muted)",
    fontSize: 15,
    lineHeight: 1.5,
    maxWidth: 600,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 20,
  },
  card: {
    background: "var(--card)",
    borderRadius: 20,
    border: "1px solid var(--border)",
    overflow: "hidden",
    boxShadow: "var(--shadow-sm)",
    transition: "all 0.3s ease",
    display: "flex",
    flexDirection: "column",
  },
  cardSynced: {
    borderColor: "rgba(16, 185, 129, 0.4)",
    boxShadow: "0 0 0 1px rgba(16, 185, 129, 0.2), var(--shadow-sm)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    padding: 24,
    flex: 1,
  },
  cardLogo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardLogoGlyph: {
    width: 56,
    height: 56,
    borderRadius: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 18,
  },
  cardInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  cardDesc: {
    fontSize: 14,
    color: "var(--muted)",
    lineHeight: 1.5,
    margin: 0,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  badgeSynced: {
    background: "rgba(16, 185, 129, 0.15)",
    color: "var(--success)",
    border: "1px solid rgba(16, 185, 129, 0.3)",
  },
  badgeComingSoon: {
    background: "var(--card-muted)",
    color: "var(--muted)",
    border: "1px solid var(--border)",
  },
  cardActions: {
    padding: "16px 24px",
    borderTop: "1px solid var(--border)",
    background: "var(--card-muted)",
    display: "flex",
    justifyContent: "flex-end",
  },
  btnSync: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 20px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  btnSynced: {
    background: "linear-gradient(135deg, var(--success), #059669)",
  },
  btnDisabled: {
    background: "var(--card-muted)",
    color: "var(--muted)",
    border: "1px solid var(--border)",
    cursor: "not-allowed",
  },
  stats: {
    display: "flex",
    gap: 16,
  },
  statCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 24px",
    borderRadius: 14,
    background: "var(--card)",
    border: "1px solid var(--border)",
  },
  statIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 10,
    flexShrink: 0,
  },
  statInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--foreground)",
  },
  statLabel: {
    fontSize: 13,
    color: "var(--muted)",
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────────────────── */
export default function SyncPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({
    whatsapp: "idle",
    telegram: "idle",
    shopee: "idle",
    lazada: "idle",
    tiktok: "idle",
    instagram: "idle",
  });

  const markSynced = (key: CardKey) => setSyncState((s) => ({ ...s, [key]: "synced" }));

  useEffect(() => {
    try {
      const auth = getFirebaseAuth();
      setEmail(auth.currentUser?.email ?? null);
    } catch {
      setEmail(null);
    }
  }, []);

  const syncedCount = Object.values(syncState).filter((s) => s === "synced").length;
  const availableCount = cards.filter((c) => c.canSync).length;

  const renderLogo = (card: Card) => {
    if (card.logoSrc) {
      return (
        <div style={{ ...styles.cardLogo, background: card.tint }}>
          <img
            src={card.logoSrc}
            alt={`${card.name} logo`}
            style={{
              width: card.logoSize ?? 40,
              height: card.logoSize ?? 40,
              objectFit: "contain",
            }}
          />
        </div>
      );
    }

    return (
      <div
        style={{
          ...styles.cardLogoGlyph,
          background: card.tint,
          color: card.accent,
        }}
      >
        {card.glyph}
      </div>
    );
  };

  const renderAction = (card: Card) => {
    const isSynced = syncState[card.key] === "synced";

    if (!card.canSync) {
      return (
        <button style={{ ...styles.btnSync, ...styles.btnDisabled }} disabled>
          {Icons.clock}
          Coming Soon
        </button>
      );
    }

    if (card.key === "whatsapp") {
      return (
        <WhatsAppEmbeddedSignupButton
          email={email ?? undefined}
          onConnected={() => markSynced("whatsapp")}
          label="Connect"
          syncedLabel="Connected"
          className="btn"
          style={{
            ...styles.btnSync,
            ...(isSynced ? styles.btnSynced : {}),
          }}
        />
      );
    }

    if (card.key === "telegram") {
      return (
        <button
          onClick={() => markSynced("telegram")}
          disabled={isSynced}
          style={{
            ...styles.btnSync,
            ...(isSynced ? styles.btnSynced : {}),
          }}
        >
          {isSynced ? Icons.check : Icons.link}
          {isSynced ? "Connected" : "Connect"}
        </button>
      );
    }

    return null;
  };

  return (
    <div style={styles.page}>
      {/* Cards Grid */}
      <div style={styles.grid}>
        {cards.map((card) => {
          const isSynced = syncState[card.key] === "synced";

          return (
            <div
              key={card.key}
              style={{
                ...styles.card,
                ...(isSynced ? styles.cardSynced : {}),
              }}
            >
              <div style={styles.cardHeader}>
                {renderLogo(card)}
                <div style={styles.cardInfo}>
                  <div style={styles.cardTitleRow}>
                    <h3 style={styles.cardTitle}>{card.name}</h3>
                    {isSynced && (
                      <span style={{ ...styles.badge, ...styles.badgeSynced }}>
                        {Icons.check}
                        Connected
                      </span>
                    )}
                    {card.comingSoon && (
                      <span style={{ ...styles.badge, ...styles.badgeComingSoon }}>
                        {Icons.clock}
                        Coming Soon
                      </span>
                    )}
                  </div>
                  <p style={styles.cardDesc}>{card.desc}</p>
                </div>
              </div>
              <div style={styles.cardActions}>
                {renderAction(card)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
