"use client";

import type { CSSProperties, ReactNode } from "react";
import type { DocType } from "../types";

export const UploadIcons = {
  upload: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  file: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  check: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  loader: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}>
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
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
  chat: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  list: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  credit: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
  mapPin: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  refresh: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
  alert: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  cloud: (
    <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <path d="M12 13v6" />
      <path d="M9.5 15.5 12 13l2.5 2.5" />
    </svg>
  ),
} satisfies Record<string, ReactNode>;

export const DOC_SLOT_ICONS: Record<DocType, ReactNode> = {
  considerations: UploadIcons.bot,
  conversations: UploadIcons.chat,
  inventory: UploadIcons.list,
  bank: UploadIcons.credit,
  address: UploadIcons.mapPin,
};

export function getEmailDomain(email?: string | null): string | undefined {
  const normalized = String(email || "").trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  return atIndex > 0 ? normalized.slice(atIndex + 1) : undefined;
}

export const uploadStyles: Record<string, CSSProperties> = {
  page: { display: "flex", flexDirection: "column", gap: 24, width: "100%", padding: "0 24px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, alignItems: "stretch" },
  card: {
    background: "var(--card)",
    borderRadius: 20,
    border: "1px solid var(--border)",
    overflow: "hidden",
    boxShadow: "var(--shadow-sm)",
    transition: "all 0.3s ease",
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  cardHeader: { display: "flex", alignItems: "center", gap: 14, padding: "20px 24px", borderBottom: "1px solid var(--border)" },
  cardIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 14,
    color: "var(--gold-light)",
    background: "rgba(184, 134, 11, 0.2)",
    flexShrink: 0,
  },
  cardInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 4 },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 600, color: "var(--foreground)" },
  cardHint: { fontSize: 13, color: "var(--muted)", lineHeight: 1.4 },
  cardStatus: { display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 },
  cardBody: { padding: 24, display: "flex", flexDirection: "column", gap: 16, flex: 1 },
  dropzone: {
    border: "2px dashed var(--border)",
    borderRadius: 16,
    padding: "24px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    background: "var(--card-muted)",
    cursor: "pointer",
    transition: "all 0.2s ease",
    minHeight: 160,
  },
  dropzoneActive: { borderColor: "var(--primary)", background: "rgba(59, 130, 246, 0.06)", transform: "scale(1.01)" },
  dropzoneDisabled: { opacity: 0.55, cursor: "not-allowed" },
  dropzoneIcon: { color: "var(--muted)", marginBottom: 4 },
  dropzoneTitle: { fontSize: 16, fontWeight: 600, color: "var(--foreground)", margin: 0 },
  dropzoneHint: { fontSize: 13, color: "var(--muted)", margin: 0 },
  statusArea: { display: "flex", flexDirection: "column", gap: 12, minHeight: 88 },
  fileInfo: { display: "flex", alignItems: "center", gap: 12, padding: 12, background: "var(--card-muted)", borderRadius: 12 },
  fileIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 10,
    background: "rgba(255,255,255,0.06)",
    color: "var(--foreground)",
    flexShrink: 0,
  },
  fileDetails: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  fileName: { fontSize: 14, fontWeight: 600, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileSize: { fontSize: 12, color: "var(--muted)" },
  progressContainer: { display: "flex", alignItems: "center", gap: 8, color: "var(--accent)", minHeight: 22 },
  progressText: { fontSize: 13, fontWeight: 500 },
  errorText: { display: "flex", alignItems: "center", gap: 8, color: "var(--danger)", fontSize: 13, lineHeight: 1.4 },
  cardActions: { display: "flex", gap: 12, padding: "0 24px 24px" },
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "10px 16px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, var(--primary), var(--accent))",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    flex: 1,
  },
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--card)",
    color: "var(--foreground)",
    fontWeight: 600,
    cursor: "pointer",
    flex: 1,
  },
  btnSuccess: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid rgba(16, 185, 129, 0.3)",
    background: "rgba(16, 185, 129, 0.12)",
    color: "var(--success)",
    fontWeight: 600,
    cursor: "pointer",
    flex: 1,
  },
  btnDisabled: { opacity: 0.55, cursor: "not-allowed" },
  tipCard: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "18px 20px",
    borderRadius: 16,
    background: "linear-gradient(135deg, rgba(14, 26, 61, 0.95), rgba(12, 20, 48, 0.92))",
    border: "1px solid rgba(212, 164, 87, 0.18)",
    boxShadow: "var(--shadow-sm)",
  },
  tipIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "linear-gradient(135deg, var(--primary), var(--accent))",
    color: "#fff",
    flexShrink: 0,
  },
  tipContent: { display: "flex", flexDirection: "column", gap: 6 },
  tipTitle: { fontSize: 15, fontWeight: 600, color: "var(--foreground)", margin: 0 },
  tipDesc: { fontSize: 14, color: "var(--muted)", margin: 0, lineHeight: 1.5 },
};
