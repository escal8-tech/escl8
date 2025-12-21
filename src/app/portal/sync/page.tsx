"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { WhatsAppEmbeddedSignupButton } from "@/components/WhatsAppEmbeddedSignup";

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

const cards: Card[] = [
  { key: "whatsapp", name: "WhatsApp", desc: "Connect WhatsApp Business for messaging and syncing.", canSync: true, comingSoon: false, accent: "#22c55e", tint: "rgba(34,197,94,0.10)", glyph: "WA", logoSrc: "/whatsapp.svg" },
  { key: "telegram", name: "Telegram", desc: "Sync Telegram bot conversations.", canSync: true, comingSoon: false, accent: "#229ed9", tint: "rgba(34,158,217,0.12)", glyph: "TG", logoSrc: "/telegram.png", logoSize: 51 },
  { key: "shopee", name: "Shopee", desc: "Sync orders and catalog from Shopee.", canSync: false, comingSoon: true, accent: "#f97316", tint: "rgba(249,115,22,0.08)", glyph: "SH", logoSrc: "/shopee.png", logoSize: 56 },
  { key: "lazada", name: "Lazada", desc: "Sync orders and catalog from Lazada.", canSync: false, comingSoon: true, accent: "#7c3aed", tint: "rgba(124,58,237,0.08)", glyph: "LZ", logoSrc: "/lazada.png" },
  { key: "tiktok", name: "TikTok Shop", desc: "Sync TikTok Shop orders and catalog.", canSync: false, comingSoon: true, accent: "#ec4899", tint: "rgba(236,72,153,0.08)", glyph: "TT" },
  { key: "instagram", name: "Instagram", desc: "Connect Instagram messaging.", canSync: false, comingSoon: true, accent: "#f472b6", tint: "rgba(244,114,182,0.10)", glyph: "IG" },
];

type SyncState = Record<CardKey, "idle" | "synced">;

export default function SyncPage() {
  const [syncState, setSyncState] = useState<SyncState>({
    whatsapp: "idle",
    telegram: "idle",
    shopee: "idle",
    lazada: "idle",
    tiktok: "idle",
    instagram: "idle",
  });

  const markSynced = (key: CardKey) => setSyncState((s) => ({ ...s, [key]: "synced" }));

  const buttonBase = useMemo(() => ({
    height: 32,
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 13,
    padding: "0 12px",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#fff",
    cursor: "pointer",
    width: "fit-content",
    transition: "all 140ms ease",
  } satisfies CSSProperties), []);

  const renderLogo = (card: Card) => {
    if (card.logoSrc) {
      const size = card.logoSize ?? 64;
      return (
        <span
          style={{
            width: size,
            height: size,
            borderRadius: 16,
            overflow: "hidden",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img src={card.logoSrc} alt={`${card.name} logo`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </span>
      );
    }

    return (
      <span
        aria-hidden
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: -0.2,
          background: card.tint,
          color: card.accent,
          boxShadow: `0 0 0 1px ${card.tint}`,
        }}
      >
        {card.glyph}
      </span>
    );
  };

  return (
  <div className="container" style={{ padding: "24px 0 80px", display: "grid", gap: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, letterSpacing: "-0.3px" }}>Service sync</h1>
          <p className="muted" style={{ marginTop: 8 }}>Connect messaging and commerce channels. WhatsApp and Telegram can sync now; others are coming soon.</p>
        </div>
      </header>

      <div className="grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 24 }}>
        {cards.map((card) => {
          const isSynced = syncState[card.key] === "synced";
          const border = isSynced ? "1px solid rgba(34,197,94,0.5)" : "1px solid var(--border)";
          const background = isSynced ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.03)";

          const syncedChip = isSynced && !card.comingSoon ? (
            <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(34,197,94,0.8)", color: "rgb(34,197,94)" }}>Synced</span>
          ) : null;

          const action = (() => {
            if (!card.canSync) {
              return (
                <button
                  className="btn"
                  disabled
                  style={{
                    ...buttonBase,
                    background: "rgba(255,255,255,0.04)",
                    borderColor: "var(--border)",
                    color: "#9ca3af",
                    cursor: "not-allowed",
                  }}
                >
                  Coming soon
                </button>
              );
            }

            if (card.key === "whatsapp") {
              return (
                <WhatsAppEmbeddedSignupButton
                  onConnected={() => markSynced("whatsapp")}
                  label="Sync"
                  syncedLabel="Synced"
                  className="btn"
                  style={{
                    ...buttonBase,
                    background: isSynced ? "#1e3a8a" : "#2563eb",
                    borderColor: isSynced ? "#1e3a8a" : "#2563eb",
                    color: "#fff",
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
                    ...buttonBase,
                    background: isSynced ? "#1e3a8a" : "#2563eb",
                    borderColor: isSynced ? "#1e3a8a" : "#2563eb",
                    color: "#fff",
                    cursor: isSynced ? "default" : "pointer",
                  }}
                >
                  {isSynced ? "Synced" : "Sync"}
                </button>
              );
            }

            return null;
          })();

          return (
            <div
              key={card.key}
              className="glass"
              style={{
                padding: 24,
                border,
                background,
                display: "grid",
                gap: 16,
                borderRadius: 18,
                minHeight: 240,
                gridTemplateRows: "auto 1fr auto",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {renderLogo(card)}
                  <div>
                    <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>{card.name}</h3>
                    <p className="muted" style={{ marginTop: 4 }}>{card.desc}</p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {syncedChip}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-end", marginTop: 4 }}>
                {action}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
