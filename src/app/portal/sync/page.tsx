"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useIsMobileViewport } from "@/app/portal/hooks/useIsMobileViewport";
import { WhatsAppEmbeddedSignupButton } from "@/components/WhatsAppEmbeddedSignup";
import { useToast } from "@/components/ToastProvider";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { buildWebsiteWidgetSnippet, normalizeWebsiteWidgetSettings } from "@/lib/website-widget";
import { trpc } from "@/utils/trpc";

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
type CardKey = "whatsapp" | "website" | "telegram" | "shopee" | "lazada" | "tiktok" | "instagram";

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
  { key: "website", name: "Website Widget", desc: "Add a floating chat widget to your website with one snippet.", canSync: true, comingSoon: false, accent: "#2563eb", tint: "rgba(37,99,235,0.10)", glyph: "</>" },
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
    width: "100%",
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
    minWidth: 0,
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
    minWidth: 0,
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
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(7, 10, 24, 0.68)",
    backdropFilter: "blur(8px)",
    display: "grid",
    placeItems: "center",
    padding: 24,
    zIndex: 5000,
  },
  modalCard: {
    width: "min(760px, 100%)",
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 24,
    boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
    padding: 28,
    display: "grid",
    gap: 18,
  },
  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  modalTitleWrap: {
    display: "grid",
    gap: 6,
  },
  modalTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: "var(--foreground)",
    letterSpacing: "-0.02em",
  },
  modalDesc: {
    margin: 0,
    color: "var(--muted)",
    fontSize: 14,
    lineHeight: 1.6,
  },
  closeIconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--card-muted)",
    color: "var(--foreground)",
    cursor: "pointer",
    fontSize: 18,
  },
  codeLabel: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  codeBox: {
    width: "100%",
    minHeight: 110,
    resize: "vertical",
    borderRadius: 16,
    border: "1px solid var(--border)",
    background: "#071124",
    color: "#dbeafe",
    padding: 16,
    fontSize: 13,
    lineHeight: 1.6,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  modalActions: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  modalHint: {
    color: "var(--muted)",
    fontSize: 13,
    lineHeight: 1.5,
  },
  secondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--card-muted)",
    color: "var(--foreground)",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────────────────── */
export default function SyncPage() {
  const isMobile = useIsMobileViewport();
  const [email] = useState<string | null>(() => getFirebaseAuth()?.currentUser?.email ?? null);
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [widgetSnippet, setWidgetSnippet] = useState("");
  const [syncState, setSyncState] = useState<SyncState>({
    whatsapp: "idle",
    website: "idle",
    telegram: "idle",
    shopee: "idle",
    lazada: "idle",
    tiktok: "idle",
    instagram: "idle",
  });
  const toast = useToast();
  const phoneNumbersQuery = trpc.business.listPhoneNumbers.useQuery();
  const businessQuery = trpc.business.getMine.useQuery(
    { email: email ?? "" },
    { enabled: Boolean(email) },
  );
  const ensureWebsiteWidget = trpc.business.ensureWebsiteWidget.useMutation();
  const whatsappConnected = (phoneNumbersQuery.data?.length ?? 0) > 0;
  const websiteWidget = normalizeWebsiteWidgetSettings(businessQuery.data?.settings);
  const websiteConnected = Boolean(websiteWidget.key);

  const pageStyle = useMemo(
    () => ({
      ...styles.page,
      padding: isMobile ? "0 12px" : styles.page.padding,
      gap: isMobile ? 16 : styles.page.gap,
    }),
    [isMobile],
  );
  const gridStyle = useMemo(
    () => ({
      ...styles.grid,
      gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : styles.grid.gridTemplateColumns,
      gap: isMobile ? 16 : styles.grid.gap,
    }),
    [isMobile],
  );
  const modalCardStyle = useMemo(
    () => ({
      ...styles.modalCard,
      padding: isMobile ? 20 : styles.modalCard.padding,
      borderRadius: isMobile ? 20 : styles.modalCard.borderRadius,
    }),
    [isMobile],
  );

  const markSynced = (key: CardKey) => setSyncState((s) => ({ ...s, [key]: "synced" }));

  const openWebsiteWidgetModal = async () => {
    if (!email || !businessQuery.data?.id) {
      toast.show({
        type: "error",
        title: "Unable to prepare widget",
        message: "Your business session is missing. Refresh and try again.",
        durationMs: 5000,
      });
      return;
    }

    try {
      const result = await ensureWebsiteWidget.mutateAsync({
        email,
        businessId: businessQuery.data.id,
      });
      if (!result.key) {
        throw new Error("Widget key was not generated");
      }
      setWidgetSnippet(buildWebsiteWidgetSnippet(window.location.origin, result.key));
      setWidgetModalOpen(true);
    } catch (error) {
      toast.show({
        type: "error",
        title: "Widget setup failed",
        message: error instanceof Error ? error.message : "Could not generate widget snippet.",
        durationMs: 6000,
      });
    }
  };

  const copyWidgetSnippet = async () => {
    try {
      await navigator.clipboard.writeText(widgetSnippet);
      toast.show({
        type: "success",
        title: "Snippet copied",
        message: "Paste it into your website or Wix custom code block.",
        durationMs: 3000,
      });
    } catch {
      toast.show({
        type: "error",
        title: "Copy failed",
        message: "Copy the snippet manually from the box.",
        durationMs: 4000,
      });
    }
  };

  const renderLogo = (card: Card) => {
    if (card.logoSrc) {
      return (
        <div style={{ ...styles.cardLogo, background: card.tint }}>
          <Image
            src={card.logoSrc}
            alt={`${card.name} logo`}
            width={card.logoSize ?? 40}
            height={card.logoSize ?? 40}
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
    const isSynced = card.key === "whatsapp"
      ? whatsappConnected
      : card.key === "website"
        ? websiteConnected
        : syncState[card.key] === "synced";
    const actionStyle = {
      width: isMobile ? "100%" : undefined,
      justifyContent: "center" as const,
    };

    if (!card.canSync) {
      return (
        <button style={{ ...styles.btnSync, ...styles.btnDisabled, ...actionStyle }} disabled>
          {Icons.clock}
          Coming Soon
        </button>
      );
    }

    if (card.key === "whatsapp") {
      return (
        <WhatsAppEmbeddedSignupButton
          email={email ?? undefined}
          connected={whatsappConnected}
          onConnected={() => {
            markSynced("whatsapp");
            phoneNumbersQuery.refetch();
          }}
          label="Connect"
          syncedLabel="Connected"
          className="btn"
          style={{
            ...styles.btnSync,
            ...(isSynced ? styles.btnSynced : {}),
            ...actionStyle,
          }}
        />
      );
    }

    if (card.key === "website") {
      return (
        <button
          onClick={() => {
            void openWebsiteWidgetModal();
          }}
          disabled={ensureWebsiteWidget.isPending || !email}
          style={{
            ...styles.btnSync,
            ...(isSynced ? styles.btnSynced : {}),
            ...((ensureWebsiteWidget.isPending || !email) ? styles.btnDisabled : {}),
            ...actionStyle,
          }}
        >
          {isSynced ? Icons.check : Icons.link}
          {ensureWebsiteWidget.isPending ? "Preparing…" : isSynced ? "View Snippet" : "Connect"}
        </button>
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
            ...actionStyle,
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
    <div style={pageStyle}>
      {widgetModalOpen ? (
        <div
          style={styles.modalBackdrop}
          onClick={() => setWidgetModalOpen(false)}
        >
          <div
            style={modalCardStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div style={styles.modalTitleWrap}>
                <h2 style={styles.modalTitle}>Website Widget Snippet</h2>
                <p style={styles.modalDesc}>
                  Paste this one-line script into your website, Wix custom code, or before the closing
                  <code> {"</body>"} </code>
                  tag to load the floating AI chat widget.
                </p>
              </div>
              <button
                type="button"
                style={styles.closeIconButton}
                onClick={() => setWidgetModalOpen(false)}
                aria-label="Close website widget modal"
              >
                ×
              </button>
            </div>

            <p style={styles.codeLabel}>Script snippet</p>
            <textarea
              readOnly
              value={widgetSnippet}
              style={styles.codeBox}
              aria-label="Website widget snippet"
            />

            <div style={styles.modalActions}>
              <div style={styles.modalHint}>
                This snippet injects a floating bubble and animated chat panel directly into the site.
                No iframe setup is required by the customer.
              </div>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => {
                  void copyWidgetSnippet();
                }}
              >
                Copy Snippet
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Cards Grid */}
      <div style={gridStyle}>
        {cards.map((card) => {
          const isSynced = card.key === "whatsapp"
            ? whatsappConnected
            : card.key === "website"
              ? websiteConnected
              : syncState[card.key] === "synced";

          return (
            <div
              key={card.key}
              style={{
                ...styles.card,
                ...(isSynced ? styles.cardSynced : {}),
              }}
            >
              <div
                style={{
                  ...styles.cardHeader,
                  padding: isMobile ? "18px" : styles.cardHeader.padding,
                  alignItems: "flex-start",
                }}
              >
                {renderLogo(card)}
                <div style={{ ...styles.cardInfo, minWidth: 0 }}>
                  <div style={{ ...styles.cardTitleRow, flexWrap: "wrap" }}>
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
              <div
                style={{
                  ...styles.cardActions,
                  padding: isMobile ? "14px 18px 18px" : styles.cardActions.padding,
                  justifyContent: "stretch",
                }}
              >
                {renderAction(card)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
