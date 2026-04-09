"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { fetchWithFirebaseAuth, getFirebaseIdTokenOrThrow } from "@/lib/client-auth-ops";
import { describeCompanyGmailError } from "@/lib/company-gmail";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { trpc } from "@/utils/trpc";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { recordClientBusinessEvent, shouldCaptureUnexpectedClientError } from "@/lib/client-business-monitoring";
import type { OrderPaymentMethod } from "@/lib/order-settings";
import { buildWebsiteWidgetSnippet, normalizeWebsiteWidgetSettings } from "@/lib/website-widget";
import { WhatsAppEmbeddedSignupButton } from "@/components/WhatsAppEmbeddedSignup";

/* ─────────────────────────────────────────────────────────────────────────────
   ICONS (inline SVGs for clean dependency-free icons)
───────────────────────────────────────────────────────────────────────────── */
const Icons = {
  user: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  calendar: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  whatsapp: (
    <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  ),
  bell: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  shield: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  bot: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  ),
  clock: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  check: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  link: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  logout: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  save: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1-2 2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  users: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  building: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  ),
  toggle: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
      <circle cx="8" cy="12" r="3" />
    </svg>
  ),
  ticket: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V9z" />
      <path d="M9 9v12" />
    </svg>
  ),
};

/* ─────────────────────────────────────────────────────────────────────────────
   STYLES (inline CSS in this file for the settings page)
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
    paddingTop: 8,
  },
  headerTitle: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: "var(--foreground)",
    letterSpacing: "-0.025em",
  },
  headerSubtitle: {
    marginTop: 6,
    color: "var(--muted)",
    fontSize: 15,
    lineHeight: 1.5,
  },
  tabs: {
    display: "flex",
    gap: 6,
    padding: "4px",
    background: "var(--card-muted)",
    borderRadius: 12,
    width: "fit-content",
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 18px",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease",
    background: "transparent",
    color: "var(--muted)",
  },
  tabActive: {
    background: "var(--card)",
    color: "var(--foreground)",
    boxShadow: "var(--shadow-sm)",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  card: {
    background: "var(--card)",
    borderRadius: 16,
    border: "1px solid var(--border)",
    overflow: "hidden",
    boxShadow: "var(--shadow-sm)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "20px 24px",
    borderBottom: "1px solid var(--border)",
    background: "linear-gradient(to right, var(--card), var(--card-muted))",
  },
  cardIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
    color: "#fff",
  },
  cardIconSecondary: {
    background: "linear-gradient(135deg, var(--accent), var(--cyan-600))",
  },
  cardTitle: {
    margin: 0,
    fontSize: 17,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  cardDescription: {
    margin: "4px 0 0",
    fontSize: 13,
    color: "var(--muted)",
  },
  cardBody: {
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  profileInfo: {
    display: "flex",
    alignItems: "center",
    gap: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: "linear-gradient(135deg, var(--primary), var(--accent))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 26,
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
  },
  profileDetails: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  profileName: {
    fontSize: 18,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  profileEmail: {
    fontSize: 14,
    color: "var(--muted)",
  },
  profileBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 500,
    background: "rgba(0, 212, 255, 0.1)",
    color: "var(--accent)",
    marginTop: 6,
    width: "fit-content",
  },
  usageCard: {
    gridColumn: "1 / -1",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--background)",
  },
  usageRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  usageTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  usageValue: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--foreground)",
    fontFamily: "monospace",
  },
  usageHint: {
    margin: 0,
    fontSize: 12,
    color: "var(--muted)",
  },
  usageTrack: {
    width: "100%",
    height: 8,
    borderRadius: 999,
    background: "var(--card-muted)",
    overflow: "hidden",
  },
  usageFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, var(--accent), var(--primary))",
    transition: "width 0.25s ease",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 20,
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--foreground)",
    letterSpacing: "0.01em",
  },
  labelHint: {
    fontSize: 12,
    color: "var(--muted)",
    fontWeight: 400,
    marginTop: 2,
  },
  input: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    fontSize: 14,
    color: "var(--foreground)",
    outline: "none",
    transition: "all 0.2s ease",
  },
  select: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    fontSize: 14,
    color: "var(--foreground)",
    outline: "none",
    cursor: "pointer",
  },
  textarea: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    fontSize: 14,
    color: "var(--foreground)",
    outline: "none",
    resize: "vertical" as const,
    minHeight: 120,
    fontFamily: "inherit",
    lineHeight: 1.5,
  },
  toggle: {
    position: "relative" as const,
    width: 52,
    height: 28,
    borderRadius: 14,
    background: "var(--border)",
    cursor: "pointer",
    transition: "all 0.3s ease",
    flexShrink: 0,
  },
  toggleActive: {
    background: "var(--accent)",
  },
  toggleKnob: {
    position: "absolute" as const,
    top: 2,
    left: 2,
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
    transition: "all 0.3s ease",
  },
  toggleKnobActive: {
    left: 26,
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 0",
    borderBottom: "1px solid var(--border)",
  },
  toggleRowLast: {
    borderBottom: "none",
  },
  toggleInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--foreground)",
  },
  toggleDescription: {
    fontSize: 13,
    color: "var(--muted)",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    padding: "16px 24px",
    borderTop: "1px solid var(--border)",
    background: "var(--card-muted)",
  },
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 24px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: "0 4px 14px rgba(0, 51, 160, 0.3)",
  },
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 24px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  btnDanger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 24px",
    borderRadius: 10,
    border: "none",
    background: "var(--danger)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  statusCard: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: 20,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--background)",
  },
  statusIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 12,
    flexShrink: 0,
  },
  statusConnected: {
    background: "rgba(16, 185, 129, 0.1)",
    color: "var(--success)",
  },
  statusDisconnected: {
    background: "rgba(239, 68, 68, 0.1)",
    color: "var(--danger)",
  },
  statusInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  statusDescription: {
    fontSize: 13,
    color: "var(--muted)",
  },
  timeInputs: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "end",
    gap: 16,
  },
  timeSeparator: {
    padding: "12px 0",
    fontSize: 14,
    color: "var(--muted)",
    fontWeight: 500,
  },
  splitGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 20,
  },
  helperCard: {
    padding: 16,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--background)",
    display: "grid",
    gap: 10,
  },
  helperTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  helperText: {
    fontSize: 13,
    color: "var(--muted)",
    lineHeight: 1.5,
  },
  badgePositive: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    color: "#34d399",
    background: "rgba(16, 185, 129, 0.12)",
    border: "1px solid rgba(16, 185, 129, 0.24)",
    width: "fit-content",
  },
  integrationGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 20,
  },
  integrationTile: {
    border: "1px solid var(--border)",
    borderRadius: 16,
    background: "var(--background)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  integrationTileHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: 18,
  },
  integrationTileIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontWeight: 700,
    color: "#fff",
  },
  integrationTileBody: {
    display: "grid",
    gap: 8,
    minWidth: 0,
    flex: 1,
  },
  integrationTileTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  integrationTileTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: "var(--foreground)",
    margin: 0,
  },
  integrationTileDescription: {
    fontSize: 13,
    color: "var(--muted)",
    lineHeight: 1.5,
    margin: 0,
  },
  integrationTileFooter: {
    padding: "14px 18px 18px",
    borderTop: "1px solid var(--border)",
    background: "var(--card-muted)",
    display: "flex",
    justifyContent: "flex-end",
  },
  integrationBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    border: "1px solid var(--border)",
    background: "var(--card-muted)",
    color: "var(--muted)",
  },
  qrPreview: {
    maxWidth: 220,
    width: "100%",
    borderRadius: 14,
    border: "1px solid var(--border)",
    display: "block",
    background: "#fff",
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
    resize: "vertical" as const,
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
};

/* ─────────────────────────────────────────────────────────────────────────────
   TOGGLE COMPONENT
───────────────────────────────────────────────────────────────────────────── */
function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (val: boolean) => void; disabled?: boolean }) {
  return (
    <div
      style={{
        ...styles.toggle,
        ...(checked ? styles.toggleActive : {}),
        ...(disabled ? { opacity: 0.45, cursor: "not-allowed" } : {}),
      }}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter") onChange(!checked);
      }}
    >
      <div style={{ ...styles.toggleKnob, ...(checked ? styles.toggleKnobActive : {}) }} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   SETTINGS PAGE TABS
───────────────────────────────────────────────────────────────────────────── */
type SettingsTab = "profile" | "booking" | "tickets" | "integrations";

const tabConfig: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: Icons.user },
  { id: "booking", label: "Booking", icon: Icons.calendar },
  { id: "tickets", label: "Tickets", icon: Icons.ticket },
  { id: "integrations", label: "Integrations", icon: Icons.whatsapp },
];


/* ─────────────────────────────────────────────────────────────────────────────
   MAIN SETTINGS PAGE
───────────────────────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const auth = getFirebaseAuth();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // Booking settings state
  const [unitCapacity, setUnitCapacity] = useState<number>(1);
  const [timeslotMinutes, setTimeslotMinutes] = useState<number>(60);
  const [openTime, setOpenTime] = useState<string>("");
  const [closeTime, setCloseTime] = useState<string>("");
  const [bookingsEnabled, setBookingsEnabled] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [ticketEnabledById, setTicketEnabledById] = useState<Record<string, boolean>>({});
  const [ticketRequiredFieldsById, setTicketRequiredFieldsById] = useState<Record<string, string>>({});
  const [savingAllTicketTypes, setSavingAllTicketTypes] = useState(false);
  const [orderPaymentMethod, setOrderPaymentMethod] = useState<OrderPaymentMethod>("manual");
  const [paymentProofAiEnabled, setPaymentProofAiEnabled] = useState(true);
  const [orderCurrency, setOrderCurrency] = useState("LKR");
  const [qrBlobPath, setQrBlobPath] = useState("");
  const [bankQrImageUrl, setBankQrImageUrl] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountInstructions, setAccountInstructions] = useState("");
  const [gmailConnectPending, setGmailConnectPending] = useState(false);
  const [qrUploadPending, setQrUploadPending] = useState(false);
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [widgetSnippet, setWidgetSnippet] = useState("");

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      setEmail(user?.email ?? null);
    });
    return () => unsub();
  }, [auth]);

  const businessQuery = trpc.business.getMine.useQuery({ email: email ?? "" }, { enabled: !!email });
  const phoneNumbersQuery = trpc.business.listPhoneNumbers.useQuery(undefined, { enabled: !!email });
  const ticketTypesQuery = trpc.tickets.listTypes.useQuery({ includeDisabled: true }, { enabled: !!email });
  const ensureWebsiteWidget = trpc.business.ensureWebsiteWidget.useMutation();
  const updateBooking = trpc.business.updateBookingConfig.useMutation({
    onSuccess: () => {
      showSuccessToast(toast, {
        title: "Settings updated",
        message: "Booking settings saved successfully.",
      });
      businessQuery.refetch();
    },
  });
  const upsertTicketType = trpc.tickets.upsertType.useMutation();
  const updateTimezone = trpc.business.updateTimezone.useMutation({
    onSuccess: () => {
      showSuccessToast(toast, {
        title: "Timezone updated",
        message: "Timezone saved successfully.",
      });
      businessQuery.refetch();
    },
  });
  const updateOrderSettings = trpc.business.updateOrderSettings.useMutation({
    onSuccess: () => {
      showSuccessToast(toast, {
        title: "Order settings updated",
        message: "Order flow settings saved successfully.",
      });
      businessQuery.refetch();
    },
  });
  const disconnectGmail = trpc.business.disconnectGmailConnection.useMutation({
    onSuccess: () => {
      showSuccessToast(toast, {
        title: "Gmail disconnected",
        message: "Order emails will pause until a company Gmail account is connected again.",
      });
      businessQuery.refetch();
    },
    onError: () => {
      showErrorToast(toast, {
        title: "Disconnect failed",
        message: "The Gmail connection could not be removed.",
      });
    },
  });
  const setWhatsappIdentityAutoReplyPaused = trpc.business.setWhatsappIdentityAutoReplyPaused.useMutation({
    onSuccess: (row) => {
      showSuccessToast(toast, {
        title: row.autoReplyPaused ? "Auto replies paused" : "Auto replies resumed",
        message: row.autoReplyPaused
          ? "The bot will keep processing messages for this number, but it will not send replies."
          : "The bot can now reply automatically again for this number.",
      });
      void phoneNumbersQuery.refetch();
    },
    onError: () => {
      showErrorToast(toast, {
        title: "Update failed",
        message: "The WhatsApp number automation setting could not be saved.",
      });
    },
  });
  const setWhatsappIdentityAiDisabled = trpc.business.setWhatsappIdentityAiDisabled.useMutation({
    onSuccess: (row) => {
      showSuccessToast(toast, {
        title: row.aiDisabled ? "AI disabled" : "AI enabled",
        message: row.aiDisabled
          ? "This number now runs in manual-only mode. No AI processing or auto replies will run."
          : "This number can use AI again.",
      });
      void phoneNumbersQuery.refetch();
    },
    onError: () => {
      showErrorToast(toast, {
        title: "Update failed",
        message: "The WhatsApp number AI mode could not be saved.",
      });
    },
  });

  useEffect(() => {
    if (businessQuery.data) {
      setUnitCapacity(businessQuery.data.bookingUnitCapacity ?? 1);
      setTimeslotMinutes(businessQuery.data.bookingTimeslotMinutes ?? 60);
      setOpenTime(businessQuery.data.bookingOpenTime ?? "");
      setCloseTime(businessQuery.data.bookingCloseTime ?? "");
      setBookingsEnabled(businessQuery.data.bookingsEnabled ?? false);
      const tz = (businessQuery.data.settings as Record<string, unknown> | null | undefined)?.timezone;
      setTimezone(typeof tz === "string" && tz ? tz : "UTC");
      const orderSettings = businessQuery.data.orderSettings;
      setOrderPaymentMethod((orderSettings?.paymentMethod as OrderPaymentMethod | undefined) ?? "manual");
      setPaymentProofAiEnabled(orderSettings?.paymentProofAiEnabled ?? true);
      setOrderCurrency(orderSettings?.currency ?? "LKR");
      setQrBlobPath(orderSettings?.bankQr?.qrBlobPath ?? "");
      setBankQrImageUrl(orderSettings?.bankQr?.qrImageUrl ?? "");
      setBankName(orderSettings?.bankQr?.bankName ?? "");
      setAccountName(orderSettings?.bankQr?.accountName ?? "");
      setAccountNumber(orderSettings?.bankQr?.accountNumber ?? "");
      setAccountInstructions(orderSettings?.bankQr?.accountInstructions ?? "");
    }
  }, [businessQuery.data]);

  useEffect(() => {
    const requestedTab = String(searchParams?.get("tab") || "").trim().toLowerCase();
    if (requestedTab === "profile" || requestedTab === "booking" || requestedTab === "tickets" || requestedTab === "integrations") {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const gmail = String(url.searchParams.get("gmail") || "").trim().toLowerCase();
    if (!gmail) return;
    if (gmail === "connected") {
      showSuccessToast(toast, {
        title: "Gmail connected",
        message: "Order emails will now be sent from the connected Gmail account.",
      });
      void businessQuery.refetch();
    } else {
      const messageMap: Record<string, string> = {
        auth_required: "Sign in again before connecting the company Gmail account.",
        forbidden: "You do not have permission to connect Gmail for this business.",
        env_missing: "Google OAuth is not configured on the server.",
        token_error: "Google rejected the Gmail connection during token exchange.",
        token_missing: "Google did not return the Gmail refresh token. Try connecting again.",
        email_missing: "Google did not return the Gmail sender address.",
        error: "The Gmail connection could not be completed.",
      };
      showErrorToast(toast, {
        title: "Gmail connection failed",
        message: messageMap[gmail] || "The Gmail connection could not be completed.",
      });
    }
    url.searchParams.delete("gmail");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [businessQuery, toast]);

  const handleLogout = async () => {
    if (!auth) {
      recordClientBusinessEvent({
        event: "auth.logout_failed",
        action: "portal-logout",
        area: "auth",
        captureInSentry: true,
        error: new Error("Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars."),
        level: "error",
        outcome: "config_missing",
        route: "/settings",
      });
      window.location.href = "/";
      return;
    }
    try {
      await signOut(auth);
      recordClientBusinessEvent({
        event: "auth.logout",
        action: "portal-logout",
        area: "auth",
        outcome: "success",
        route: "/settings",
      });
      window.location.href = "/";
    } catch (err: unknown) {
      const captureInSentry = shouldCaptureUnexpectedClientError(err);
      recordClientBusinessEvent({
        event: "auth.logout_failed",
        action: "portal-logout",
        area: "auth",
        captureInSentry,
        error: err,
        level: captureInSentry ? "error" : "warn",
        outcome: captureInSentry ? "unexpected_failure" : "handled_failure",
        route: "/settings",
      });
      throw err;
    }
  };

  const handleSaveBookingSettings = () => {
    if (!email || !businessQuery.data?.id) return;
    if (!openTime || !closeTime) {
      showErrorToast(toast, {
        title: "Booking hours missing",
        message: "Set both opening and closing times before saving booking settings.",
      });
      return;
    }
    updateBooking.mutate({
      email,
      businessId: businessQuery.data.id,
      unitCapacity,
      timeslotMinutes,
      openTime,
      closeTime,
    });
  };

  const handleSaveTimezone = () => {
    if (!email || !businessQuery.data?.id) return;
    updateTimezone.mutate({
      email,
      businessId: businessQuery.data.id,
      timezone,
    });
  };

  const normalizeTicketKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

  const getRequiredFieldsForTicket = (ticketType: {
    id: string;
    requiredFields?: string[] | null;
  }) => {
    const rawValue = ticketRequiredFieldsById[ticketType.id] ?? ((ticketType.requiredFields as string[]) ?? []).join(",");
    return String(rawValue)
      .split(",")
      .map((x) => normalizeTicketKey(x))
      .filter(Boolean);
  };

  const handleToggleTicketEnabled = async (
    ticketType: { id: string; enabled?: boolean; requiredFields?: string[] | null },
    nextEnabled: boolean,
  ) => {
    const previousEnabled = ticketEnabledById[ticketType.id] ?? (ticketType.enabled ?? true);
    setTicketEnabledById((prev) => ({ ...prev, [ticketType.id]: nextEnabled }));
    try {
      await upsertTicketType.mutateAsync({
        id: ticketType.id,
        enabled: nextEnabled,
        requiredFields: getRequiredFieldsForTicket(ticketType),
      });
      showSuccessToast(toast, {
        title: "Ticket type updated",
        message: "Ticket settings saved successfully.",
      });
      await ticketTypesQuery.refetch();
    } catch {
      setTicketEnabledById((prev) => ({ ...prev, [ticketType.id]: previousEnabled }));
      showErrorToast(toast, {
        title: "Update failed",
        message: "Ticket settings could not be saved.",
      });
    }
  };

  const handleSaveAllTicketTypes = async () => {
    if (!ticketTypesQuery.data?.length) return;
    setSavingAllTicketTypes(true);
    try {
      for (const ticketType of ticketTypesQuery.data) {
        const enabled = ticketEnabledById[ticketType.id] ?? (ticketType.enabled ?? true);
        await upsertTicketType.mutateAsync({
          id: ticketType.id,
          enabled,
          requiredFields: getRequiredFieldsForTicket(ticketType),
        });
      }
      showSuccessToast(toast, {
        title: "Ticket settings updated",
        message: "All ticket field rules were saved successfully.",
      });
      await ticketTypesQuery.refetch();
    } catch {
      showErrorToast(toast, {
        title: "Save failed",
        message: "Ticket field rules could not be saved.",
      });
    } finally {
      setSavingAllTicketTypes(false);
    }
  };

  const handleSaveOrderSettings = () => {
    if (!email || !businessQuery.data?.id) return;
    const normalizedBankName = bankName.trim();
    const normalizedAccountName = accountName.trim();
    const normalizedAccountNumber = accountNumber.trim();
    const normalizedInstructions = accountInstructions.trim();
    const hasQr = Boolean(qrBlobPath.trim() || bankQrImageUrl.trim());
    const hasBankDetails = Boolean(
      normalizedBankName || normalizedAccountName || normalizedAccountNumber || normalizedInstructions,
    );
    updateOrderSettings.mutate({
      email,
      businessId: businessQuery.data.id,
      ticketToOrderEnabled: true,
      paymentMethod: orderPaymentMethod,
      paymentProofAiEnabled,
      currency: orderCurrency.trim() || "LKR",
      bankQr: {
        showQr: orderPaymentMethod === "bank_qr" && hasQr,
        showBankDetails: orderPaymentMethod === "bank_qr" && hasBankDetails,
        qrBlobPath: qrBlobPath.trim(),
        qrImageUrl: bankQrImageUrl.trim(),
        bankName: normalizedBankName,
        accountName: normalizedAccountName,
        accountNumber: normalizedAccountNumber,
        accountInstructions: normalizedInstructions,
      },
    });
  };

  const handleUploadQrImage = async (file: File) => {
    if (!file) return;
    setQrUploadPending(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetchWithFirebaseAuth(
        "/api/settings/order-flow/qr-upload",
        {
          method: "POST",
          body: form,
        },
        {
          action: "settings-upload-order-qr",
          area: "business",
          route: "/settings",
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || "QR upload failed."));
      }
      setQrBlobPath(String(payload?.qrBlobPath || "").trim());
      setBankQrImageUrl(String(payload?.qrImageUrl || "").trim());
      showSuccessToast(toast, {
        title: "QR image uploaded",
        message: "The QR image is ready to be sent with bank / QR payment instructions.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Upload failed",
        message: error instanceof Error ? error.message : "QR image upload failed.",
      });
    } finally {
      setQrUploadPending(false);
    }
  };

  const handleConnectGmail = async () => {
    if (gmailConnectPending) return;
    setGmailConnectPending(true);
    try {
      const idToken = await getFirebaseIdTokenOrThrow({
        action: "settings-connect-gmail",
        area: "business",
        route: "/settings",
      });
      const nextUrl = new URL("/api/auth/gmail/connect", window.location.origin);
      nextUrl.searchParams.set("idToken", idToken);
      nextUrl.searchParams.set("returnTo", "/settings");
      window.location.assign(nextUrl.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start Gmail connection.";
      showErrorToast(toast, {
        title: "Gmail connection failed",
        message,
      });
      setGmailConnectPending(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!email || !businessQuery.data?.id) return;
    await disconnectGmail.mutateAsync({ email, businessId: businessQuery.data.id });
  };

  const getInitials = (email: string | null) => {
    if (!email) return "?";
    return email.substring(0, 2).toUpperCase();
  };

  const openWebsiteWidgetModal = async () => {
    if (!email || !businessQuery.data?.id) {
      showErrorToast(toast, {
        title: "Unable to prepare widget",
        message: "Your business session is missing. Refresh and try again.",
      });
      return;
    }

    try {
      const result = await ensureWebsiteWidget.mutateAsync({
        email,
        businessId: businessQuery.data.id,
      });
      if (!result.key) {
        throw new Error("Widget key was not generated.");
      }
      setWidgetSnippet(buildWebsiteWidgetSnippet(window.location.origin, result.key));
      setWidgetModalOpen(true);
    } catch (error) {
      showErrorToast(toast, {
        title: "Widget setup failed",
        message: error instanceof Error ? error.message : "Could not generate widget snippet.",
      });
    }
  };

  const copyWidgetSnippet = async () => {
    try {
      await navigator.clipboard.writeText(widgetSnippet);
      showSuccessToast(toast, {
        title: "Snippet copied",
        message: "Paste it into your website or Wix custom code block.",
      });
    } catch {
      showErrorToast(toast, {
        title: "Copy failed",
        message: "Copy the snippet manually from the code box.",
      });
    }
  };

  const responsesUsed = Number(businessQuery.data?.responseUsage?.used ?? 0);
  const responsesMax = Number(businessQuery.data?.responseUsage?.max ?? 50_000);
  const responsesPercent = Math.min(100, Math.max(0, (responsesUsed / Math.max(1, responsesMax)) * 100));
  const websiteWidget = normalizeWebsiteWidgetSettings(businessQuery.data?.settings);
  const whatsappConnected = (phoneNumbersQuery.data?.length ?? 0) > 0;
  const fmtInt = (value: number) => value.toLocaleString("en-US");

  const renderProfileTab = () => (
    <div style={styles.section}>
      {/* Profile Card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardIcon}>{Icons.user}</div>
          <div>
            <h3 style={styles.cardTitle}>Profile Information</h3>
            <p style={styles.cardDescription}>Your personal account details</p>
          </div>
        </div>
        <div style={styles.cardBody}>
          <div style={styles.profileInfo}>
            <div style={styles.avatar}>{getInitials(email)}</div>
            <div style={styles.profileDetails}>
              <div style={styles.profileName}>{email?.split("@")[0] || "User"}</div>
              <div style={styles.profileEmail}>{email || "No email"}</div>
              <div style={styles.profileBadge}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
                Active Account
              </div>
            </div>
          </div>
        </div>
        <div style={styles.actions}>
          <button style={styles.btnDanger} onClick={handleLogout}>
            {Icons.logout}
            Sign Out
          </button>
        </div>
      </div>

      {/* Business Card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ ...styles.cardIcon, ...styles.cardIconSecondary }}>{Icons.building}</div>
          <div>
            <h3 style={styles.cardTitle}>Business Details</h3>
            <p style={styles.cardDescription}>Your organization information</p>
          </div>
        </div>
        <div style={styles.cardBody}>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Business Name</label>
              <input
                type="text"
                style={styles.input}
                value={businessQuery.data?.name || ""}
                readOnly
                placeholder="Business name"
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Business ID</label>
              <input
                type="text"
                style={{ ...styles.input, fontFamily: "monospace", fontSize: 12 }}
                value={businessQuery.data?.id || ""}
                readOnly
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Business Timezone (IANA)</label>
              <input
                type="text"
                style={styles.input}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. Asia/Kuala_Lumpur"
              />
            </div>
            <div style={styles.usageCard}>
              <div style={styles.usageRow}>
                <span style={styles.usageTitle}>AI Responses Used</span>
                <span style={styles.usageValue}>
                  {fmtInt(responsesUsed)} / {fmtInt(responsesMax)}
                </span>
              </div>
              <div style={styles.usageTrack}>
                <div style={{ ...styles.usageFill, width: `${responsesPercent}%` }} />
              </div>
              <p style={styles.usageHint}>
                Display only for beta. The bot is not blocked if usage goes above {fmtInt(responsesMax)}.
              </p>
            </div>
          </div>
        </div>
        <div style={styles.actions}>
          <button
            style={styles.btnPrimary}
            onClick={handleSaveTimezone}
            disabled={updateTimezone.isPending}
          >
            {Icons.save}
            {updateTimezone.isPending ? "Saving..." : "Save Timezone"}
          </button>
        </div>
      </div>

      {/* AI Bot Instructions */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardIcon}>{Icons.bot}</div>
          <div>
            <h3 style={styles.cardTitle}>AI Assistant Instructions</h3>
            <p style={styles.cardDescription}>Customize your AI bot&apos;s behavior and personality</p>
          </div>
        </div>
        <div style={styles.cardBody}>
          <div style={styles.formGroup}>
            <label style={styles.label}>
              System Instructions
              <p style={styles.labelHint}>These instructions guide how your AI assistant responds to customers</p>
            </label>
            <textarea
              style={styles.textarea}
              value={businessQuery.data?.instructions || ""}
              readOnly
              placeholder="AI instructions..."
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderBookingTab = () => (
    <div style={styles.section}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardIcon}>{Icons.calendar}</div>
          <div>
            <h3 style={styles.cardTitle}>Booking Configuration</h3>
            <p style={styles.cardDescription}>Configure your booking system settings</p>
          </div>
        </div>
        <div style={styles.cardBody}>
          {/* Toggle Section */}
          <div style={{ ...styles.toggleRow }}>
            <div style={styles.toggleInfo}>
              <span style={styles.toggleLabel}>Enable Bookings</span>
              <span style={styles.toggleDescription}>Allow customers to book appointments through WhatsApp</span>
            </div>
            <Toggle checked={bookingsEnabled} onChange={setBookingsEnabled} />
          </div>

          {/* Capacity and Timeslot */}
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Slot Capacity
                <p style={styles.labelHint}>Max bookings per time slot</p>
              </label>
              <input
                type="number"
                style={styles.input}
                min={1}
                value={unitCapacity}
                onChange={(e) => setUnitCapacity(parseInt(e.target.value) || 1)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Timeslot Duration
                <p style={styles.labelHint}>Length of each booking slot</p>
              </label>
              <PortalSelect
                value={String(timeslotMinutes)}
                onValueChange={(value) => setTimeslotMinutes(parseInt(value, 10))}
                options={[
                  { value: "15", label: "15 minutes" },
                  { value: "30", label: "30 minutes" },
                  { value: "45", label: "45 minutes" },
                  { value: "60", label: "1 hour" },
                  { value: "90", label: "1.5 hours" },
                  { value: "120", label: "2 hours" },
                ]}
                style={styles.select}
                ariaLabel="Timeslot duration"
              />
            </div>
          </div>

          {/* Business Hours */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              Business Hours
              <p style={styles.labelHint}>When customers can book appointments</p>
            </label>
            <div style={styles.timeInputs}>
              <div style={styles.formGroup}>
                <label style={{ ...styles.label, fontSize: 12, color: "var(--muted)" }}>Opening Time</label>
                <input
                  type="time"
                  style={styles.input}
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                  placeholder="Not configured"
                />
              </div>
              <span style={styles.timeSeparator}>to</span>
              <div style={styles.formGroup}>
                <label style={{ ...styles.label, fontSize: 12, color: "var(--muted)" }}>Closing Time</label>
                <input
                  type="time"
                  style={styles.input}
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                  placeholder="Not configured"
                />
              </div>
            </div>
            {(!openTime || !closeTime) && (
              <p style={{ ...styles.labelHint, color: "#b45309", marginTop: 12 }}>
                Booking hours are not configured yet. Set both times so staff and customers are not misled.
              </p>
            )}
          </div>
        </div>
        <div style={styles.actions}>
          <button style={styles.btnSecondary} onClick={() => businessQuery.refetch()}>
            Cancel
          </button>
          <button 
            style={styles.btnPrimary} 
            onClick={handleSaveBookingSettings}
            disabled={updateBooking.isPending}
          >
            {Icons.save}
            {updateBooking.isPending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );

  const renderTicketsTab = () => (
    <div style={styles.section}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardIcon}>{Icons.ticket}</div>
          <div>
            <h3 style={styles.cardTitle}>Order Flow</h3>
            <p style={styles.cardDescription}>Keep order creation tickets on one predictable path for staff.</p>
          </div>
        </div>
        <div style={styles.cardBody}>
          <div style={styles.helperCard}>
            <span style={styles.badgePositive}>{Icons.check} Always On</span>
            <div style={styles.helperTitle}>Ticket to order is always enabled</div>
            <div style={styles.helperText}>
              Order creation tickets always open the approval, payment, fulfilment, and revenue workflow. Staff no longer need a separate toggle here.
            </div>
          </div>

          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Payment Method</label>
              <PortalSelect
                value={orderPaymentMethod}
                onValueChange={(value) => setOrderPaymentMethod(value as OrderPaymentMethod)}
                options={[
                  { value: "manual", label: "Manual Collection" },
                  { value: "cod", label: "Cash on Delivery" },
                  { value: "bank_qr", label: "Bank / QR" },
                ]}
                style={styles.select}
                ariaLabel="Order payment method"
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Currency</label>
              <input
                type="text"
                style={styles.input}
                value={orderCurrency}
                onChange={(e) => setOrderCurrency(e.target.value.toUpperCase())}
                placeholder="LKR"
              />
            </div>
          </div>

          {orderPaymentMethod === "manual" ? (
            <div style={styles.helperCard}>
              <div style={styles.helperTitle}>Manual collection</div>
              <div style={styles.helperText}>
                Staff will confirm payment manually from the operations queue. No bank instructions or QR image will be sent to the customer.
              </div>
            </div>
          ) : null}

          {orderPaymentMethod === "cod" ? (
            <div style={styles.helperCard}>
              <div style={styles.helperTitle}>Cash on delivery</div>
              <div style={styles.helperText}>
                Customers will pay when the order is delivered. Payment instruction fields stay hidden because they are not used in this flow.
              </div>
            </div>
          ) : null}

          {orderPaymentMethod === "bank_qr" ? (
            <div style={styles.splitGrid}>
              <div style={styles.helperCard}>
                <div style={styles.helperTitle}>QR Payment</div>
                <div style={styles.helperText}>
                  Upload the QR image once. It is stored privately and sent to the customer as an image in WhatsApp and email-ready payment instructions.
                </div>
                <div style={{ ...styles.toggleRow, marginTop: 14 }}>
                  <div style={styles.toggleInfo}>
                    <span style={styles.toggleLabel}>Payment Proof AI Check</span>
                    <span style={styles.toggleDescription}>
                      When enabled, the system checks uploaded bank slips with AI and tags them as confirmed or invalid before staff review.
                    </span>
                  </div>
                  <Toggle checked={paymentProofAiEnabled} onChange={setPaymentProofAiEnabled} />
                </div>
                {bankQrImageUrl ? (
                  <Image
                    src={bankQrImageUrl}
                    alt="Uploaded payment QR"
                    width={220}
                    height={220}
                    unoptimized
                    style={styles.qrPreview}
                  />
                ) : (
                  <div
                    style={{
                      ...styles.helperText,
                      border: "1px dashed var(--border)",
                      borderRadius: 14,
                      padding: "18px 16px",
                      textAlign: "center",
                    }}
                  >
                    No QR image uploaded yet.
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ ...styles.btnPrimary, position: "relative", overflow: "hidden" }}>
                    {qrUploadPending ? "Uploading..." : bankQrImageUrl ? "Replace QR Image" : "Upload QR Image"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleUploadQrImage(file);
                        }
                        event.currentTarget.value = "";
                      }}
                      disabled={qrUploadPending}
                      style={{
                        position: "absolute",
                        inset: 0,
                        opacity: 0,
                        cursor: qrUploadPending ? "not-allowed" : "pointer",
                      }}
                    />
                  </label>
                  {(bankQrImageUrl || qrBlobPath) ? (
                    <button
                      type="button"
                      style={styles.btnSecondary}
                      onClick={() => {
                        setQrBlobPath("");
                        setBankQrImageUrl("");
                      }}
                    >
                      Remove QR
                    </button>
                  ) : null}
                </div>
              </div>

              <div style={styles.helperCard}>
                <div style={styles.helperTitle}>Bank Transfer Details</div>
                <div style={styles.helperText}>
                  These details are included with the payment instructions whenever Bank / QR is selected.
                </div>
                <div style={styles.formGrid}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Bank Name</label>
                    <input
                      type="text"
                      style={styles.input}
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="Commercial Bank"
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Account Name</label>
                    <input
                      type="text"
                      style={styles.input}
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      placeholder="Escl8 Pvt Ltd"
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Account Number</label>
                    <input
                      type="text"
                      style={styles.input}
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      placeholder="1234567890"
                    />
                  </div>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Transfer Instructions</label>
                  <textarea
                    style={{ ...styles.textarea, minHeight: 110 }}
                    value={accountInstructions}
                    onChange={(e) => setAccountInstructions(e.target.value)}
                    placeholder="Use the order number as the transfer reference and send the payment slip in the same chat."
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div style={styles.actions}>
          <button
            style={styles.btnPrimary}
            onClick={handleSaveOrderSettings}
            disabled={updateOrderSettings.isPending || qrUploadPending}
          >
            {Icons.save}
            {updateOrderSettings.isPending ? "Saving..." : "Save Order Flow"}
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ ...styles.cardIcon, ...styles.cardIconSecondary }}>{Icons.ticket}</div>
          <div>
            <h3 style={styles.cardTitle}>Ticket Fields</h3>
            <p style={styles.cardDescription}>Fixed ticket types. Only required fields and enable toggle are editable.</p>
          </div>
        </div>
        <div style={{ ...styles.cardBody, padding: 12 }}>
          {!ticketTypesQuery.data?.length ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>No ticket types configured yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {ticketTypesQuery.data.map((ticketType) => {
                const initialFields = ticketRequiredFieldsById[ticketType.id] ?? ((ticketType.requiredFields as string[]) ?? []).join(",");
                const isEnabled = ticketEnabledById[ticketType.id] ?? (ticketType.enabled ?? true);
                return (
                <div
                  key={ticketType.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    display: "grid",
                    gridTemplateColumns: "180px minmax(260px, 1fr) auto",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{ticketType.label}</div>
                    <div style={{ color: "var(--muted)", fontSize: 11, fontFamily: "monospace" }}>{ticketType.key}</div>
                  </div>
                  <div>
                    <input
                      type="text"
                      style={{ ...styles.input, height: 36, fontSize: 13 }}
                      value={initialFields}
                      onChange={(e) =>
                        setTicketRequiredFieldsById((prev) => ({
                          ...prev,
                          [ticketType.id]: e.target.value,
                        }))
                      }
                      placeholder="orderid,details"
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Toggle
                      checked={isEnabled}
                      onChange={(next) => void handleToggleTicketEnabled(ticketType, next)}
                    />
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
        {!!ticketTypesQuery.data?.length && (
          <div style={styles.actions}>
            <button
              style={styles.btnPrimary}
              onClick={() => void handleSaveAllTicketTypes()}
              disabled={savingAllTicketTypes}
            >
              {Icons.save}
              {savingAllTicketTypes ? "Saving..." : "Save All"}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderIntegrationsTab = () => {
    const phoneNumbers = phoneNumbersQuery.data ?? [];
    const gmailConnected = Boolean(businessQuery.data?.gmailConnected);
    const gmailAddress = String(businessQuery.data?.gmailEmail || "").trim();
    const gmailError = describeCompanyGmailError(businessQuery.data?.gmailError);
    const integrationCards = [
      {
        key: "whatsapp",
        title: "WhatsApp",
        description: "Connect WhatsApp Business so the bot can receive and reply in the main staff workflow.",
        accent: "linear-gradient(135deg, #22c55e, #128c7e)",
        connected: whatsappConnected,
      },
      {
        key: "website",
        title: "Website Widget",
        description: "Generate the one-line widget snippet for your site or Wix custom code block.",
        accent: "linear-gradient(135deg, #2563eb, #0ea5e9)",
        connected: Boolean(websiteWidget.key),
      },
      {
        key: "telegram",
        title: "Telegram",
        description: "Telegram inbox syncing will be added here next.",
        accent: "linear-gradient(135deg, #229ed9, #38bdf8)",
        connected: false,
      },
      {
        key: "shopee",
        title: "Shopee",
        description: "Shopee order and catalog syncing will land here when ready.",
        accent: "linear-gradient(135deg, #f97316, #fb923c)",
        connected: false,
      },
      {
        key: "lazada",
        title: "Lazada",
        description: "Lazada order syncing will be managed from the same integrations area.",
        accent: "linear-gradient(135deg, #7c3aed, #a855f7)",
        connected: false,
      },
      {
        key: "tiktok",
        title: "TikTok Shop",
        description: "TikTok Shop operations will be plugged in here later.",
        accent: "linear-gradient(135deg, #111827, #ec4899)",
        connected: false,
      },
      {
        key: "instagram",
        title: "Instagram",
        description: "Instagram messaging support will appear here once available.",
        accent: "linear-gradient(135deg, #f97316, #ec4899)",
        connected: false,
      },
    ] as const;

    return (
      <div style={styles.section}>
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={{ ...styles.cardIcon, background: "linear-gradient(135deg, #22c55e, #128c7e)" }}>{Icons.link}</div>
            <div>
              <h3 style={styles.cardTitle}>Integrations</h3>
              <p style={styles.cardDescription}>Connection setup, sync entry points, and channel controls now live in one place.</p>
            </div>
          </div>
          <div style={styles.cardBody}>
            <div style={styles.integrationGrid}>
              {integrationCards.map((card) => (
                <div key={card.key} style={styles.integrationTile}>
                  <div style={styles.integrationTileHeader}>
                    <div style={{ ...styles.integrationTileIcon, background: card.accent }}>
                      {card.key === "whatsapp" ? "WA" : card.key === "website" ? "</>" : card.title.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={styles.integrationTileBody}>
                      <div style={styles.integrationTileTitleRow}>
                        <h4 style={styles.integrationTileTitle}>{card.title}</h4>
                        <span
                          style={{
                            ...styles.integrationBadge,
                            ...(card.connected
                              ? {
                                  color: "#34d399",
                                  border: "1px solid rgba(16, 185, 129, 0.24)",
                                  background: "rgba(16, 185, 129, 0.12)",
                                }
                              : {}),
                          }}
                        >
                          {card.connected ? "Connected" : card.key === "whatsapp" || card.key === "website" ? "Ready" : "Coming Soon"}
                        </span>
                      </div>
                      <p style={styles.integrationTileDescription}>{card.description}</p>
                    </div>
                  </div>
                  <div style={styles.integrationTileFooter}>
                    {card.key === "whatsapp" ? (
                      <WhatsAppEmbeddedSignupButton
                        email={email ?? undefined}
                        connected={whatsappConnected}
                        onConnected={() => {
                          void phoneNumbersQuery.refetch();
                        }}
                        label="Connect"
                        syncedLabel="Connected"
                        className="btn"
                        style={{
                          ...styles.btnPrimary,
                          ...(whatsappConnected ? styles.btnSecondary : {}),
                        }}
                      />
                    ) : card.key === "website" ? (
                      <button
                        type="button"
                        style={websiteWidget.key ? styles.btnSecondary : styles.btnPrimary}
                        onClick={() => {
                          void openWebsiteWidgetModal();
                        }}
                        disabled={ensureWebsiteWidget.isPending}
                      >
                        {ensureWebsiteWidget.isPending ? "Preparing..." : websiteWidget.key ? "View Snippet" : "Generate Snippet"}
                      </button>
                    ) : (
                      <button type="button" style={styles.btnSecondary} disabled>
                        Coming Soon
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {phoneNumbers.length ? (
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <div style={{ ...styles.cardIcon, background: "linear-gradient(135deg, #25D366, #128C7E)" }}>
                {Icons.whatsapp}
              </div>
              <div>
                <h3 style={styles.cardTitle}>WhatsApp Number Controls</h3>
                <p style={styles.cardDescription}>Control automation behavior per connected WhatsApp number.</p>
              </div>
            </div>
            <div style={styles.cardBody}>
              <div style={{ display: "grid", gap: 12 }}>
                {phoneNumbers.map((phone) => (
                  <div
                    key={phone.phoneNumberId}
                    style={{
                      ...styles.toggleRow,
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                      padding: "14px 16px",
                    }}
                  >
                    <div style={styles.toggleInfo}>
                      <span style={styles.toggleLabel}>
                        {phone.displayPhoneNumber || phone.phoneNumberId}
                      </span>
                      <span style={styles.toggleDescription}>
                        {phone.aiDisabled
                          ? "AI is fully disabled for this number. Incoming messages are not processed by the bot."
                          : phone.autoReplyPaused
                            ? "Auto replies are paused for this number. Staff can reply manually while the bot keeps tracking context."
                            : "Auto replies are active for this number."}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                        <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          Auto Reply
                        </span>
                        <Toggle
                          checked={!phone.autoReplyPaused}
                          onChange={(checked) => {
                            void setWhatsappIdentityAutoReplyPaused.mutateAsync({
                              phoneNumberId: phone.phoneNumberId,
                              autoReplyPaused: !checked,
                            });
                          }}
                          disabled={Boolean(phone.aiDisabled)}
                        />
                      </div>
                      <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                        <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          AI Enabled
                        </span>
                        <Toggle
                          checked={!phone.aiDisabled}
                          onChange={(checked) => {
                            void setWhatsappIdentityAiDisabled.mutateAsync({
                              phoneNumberId: phone.phoneNumberId,
                              aiDisabled: !checked,
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={{ ...styles.cardIcon, background: "linear-gradient(135deg, #ea4335, #fbbc05)" }}>
              {Icons.bell}
            </div>
            <div>
              <h3 style={styles.cardTitle}>Order Email Updates</h3>
              <p style={styles.cardDescription}>Send the payment-approved email from a company Gmail account after staff manually verify the payment.</p>
            </div>
          </div>
          <div style={styles.cardBody}>
            <div style={styles.statusCard}>
              <div style={{ ...styles.statusIcon, ...(gmailConnected ? styles.statusConnected : styles.statusDisconnected) }}>
                {gmailConnected ? Icons.check : Icons.bell}
              </div>
              <div style={styles.statusInfo}>
                <span style={styles.statusTitle}>
                  {gmailConnected ? "Company Gmail Connected" : "Company Gmail Not Connected"}
                </span>
                <span style={styles.statusDescription}>
                  {gmailConnected
                    ? `Order updates are sent from ${gmailAddress || "the connected Gmail account"}.`
                    : "Connect a Gmail account so all order updates can continue by email after the WhatsApp 24-hour window closes."}
                </span>
                {gmailError ? (
                  <span style={{ ...styles.statusDescription, color: "var(--danger)" }}>
                    {gmailError}
                  </span>
                ) : null}
              </div>
              {gmailConnected ? (
                <button
                  style={styles.btnSecondary}
                  onClick={() => void handleDisconnectGmail()}
                  disabled={disconnectGmail.isPending}
                >
                  {disconnectGmail.isPending ? "Disconnecting..." : "Disconnect"}
                </button>
              ) : (
                <button
                  style={styles.btnPrimary}
                  onClick={() => void handleConnectGmail()}
                  disabled={gmailConnectPending}
                >
                  {gmailConnectPending ? "Connecting..." : "Connect Gmail"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return renderProfileTab();
      case "booking":
        return renderBookingTab();
      case "tickets":
        return renderTicketsTab();
      case "integrations":
        return renderIntegrationsTab();
      default:
        return null;
    }
  };

  if (!email) {
    return (
      <div style={{ ...styles.page, paddingTop: 80, textAlign: "center" }}>
        <div className="card" style={{ padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <h2 style={{ marginBottom: 8 }}>Loading...</h2>
          <p style={{ color: "var(--muted)" }}>Please wait while we load your settings</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {widgetModalOpen ? (
        <div
          style={styles.modalBackdrop}
          onClick={() => setWidgetModalOpen(false)}
        >
          <div
            style={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div style={styles.modalTitleWrap}>
                <h2 style={styles.modalTitle}>Website Widget Snippet</h2>
                <p style={styles.modalDesc}>
                  Paste this script into your website, Wix custom code, or before the closing
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
                This snippet injects the floating chat bubble directly into the site. No iframe setup is needed on the customer side.
              </div>
              <button
                type="button"
                style={styles.btnSecondary}
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

      {/* Tabs */}
      <div style={styles.tabs}>
        {tabConfig.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            <span style={{ opacity: activeTab === tab.id ? 1 : 0.6 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ animation: "fadeIn 0.3s ease" }}>
        {renderTabContent()}
      </div>
    </div>
  );
}
