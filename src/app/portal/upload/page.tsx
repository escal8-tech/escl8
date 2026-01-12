"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import PortalAuthProvider from "@/components/PortalAuthProvider";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { trpc } from "@/utils/trpc";
import { useToast } from "@/components/ToastProvider";
import { DocSlot, DocType, ExistingMap, ExistingDoc } from "./types";

/* ─────────────────────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────────────────────── */
const Icons = {
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
};

const DOC_SLOT_ICONS: Record<DocType, React.ReactNode> = {
  considerations: Icons.bot,
  conversations: Icons.chat,
  inventory: Icons.list,
  bank: Icons.credit,
  address: Icons.mapPin,
};

const DOC_SLOT_COLORS: Record<DocType, string> = {
  considerations: "#0033A0",
  conversations: "#00D4FF",
  inventory: "#10B981",
  bank: "#8B5CF6",
  address: "#F59E0B",
};

/* ─────────────────────────────────────────────────────────────────────────────
   DOC SLOTS CONFIGURATION
───────────────────────────────────────────────────────────────────────────── */
const DOC_SLOTS: DocSlot[] = [
  {
    key: "considerations",
    title: "AI Agent Considerations",
    hint: "Guidelines, policies, and constraints the agent should follow.",
    accept: ".pdf,.txt,.doc,.docx",
  },
  {
    key: "conversations",
    title: "AI Agent Conversations",
    hint: "Sample dialogues/Q&A to teach tone and common responses.",
    accept: ".pdf,.txt,.doc,.docx",
  },
  {
    key: "inventory",
    title: "Live Stock List / Prices",
    hint: "Inventory list, SKUs, and pricing details.",
    accept: ".pdf,.csv,.txt",
  },
  {
    key: "bank",
    title: "Bank Account Details",
    hint: "Payment account information for customer instructions.",
    accept: ".pdf,.txt,.doc,.docx",
  },
  {
    key: "address",
    title: "Shop Address & Location",
    hint: "Store address, location, and directions.",
    accept: ".pdf,.txt,.doc,.docx",
  },
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
  },
  stats: {
    display: "flex",
    gap: 24,
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: "12px 20px",
    borderRadius: 12,
    background: "var(--card)",
    border: "1px solid var(--border)",
  },
  statValue: {
    fontSize: 24,
    fontWeight: 700,
    color: "var(--foreground)",
  },
  statLabel: {
    fontSize: 12,
    color: "var(--muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
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
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "20px 24px",
    borderBottom: "1px solid var(--border)",
  },
  cardIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 14,
    color: "#fff",
    flexShrink: 0,
  },
  cardInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  cardTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  cardHint: {
    fontSize: 13,
    color: "var(--muted)",
    lineHeight: 1.4,
  },
  cardStatus: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  cardBody: {
    padding: 24,
  },
  dropzone: {
    border: "2px dashed var(--border)",
    borderRadius: 16,
    padding: 32,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    cursor: "pointer",
    transition: "all 0.2s ease",
    minHeight: 180,
    textAlign: "center" as const,
  },
  dropzoneActive: {
    borderColor: "var(--accent)",
    background: "rgba(0, 212, 255, 0.05)",
  },
  dropzoneDisabled: {
    cursor: "not-allowed",
    opacity: 0.6,
  },
  dropzoneIcon: {
    color: "var(--muted)",
    marginBottom: 8,
  },
  dropzoneTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--foreground)",
    margin: 0,
  },
  dropzoneHint: {
    fontSize: 13,
    color: "var(--muted)",
    margin: 0,
  },
  fileInfo: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 12,
    background: "var(--background)",
    marginTop: 16,
  },
  fileIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 10,
    background: "var(--card-muted)",
    color: "var(--muted)",
    flexShrink: 0,
  },
  fileDetails: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  fileName: {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--foreground)",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  fileSize: {
    fontSize: 12,
    color: "var(--muted)",
  },
  errorText: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(239, 68, 68, 0.1)",
    color: "var(--danger)",
    fontSize: 13,
    marginTop: 12,
  },
  cardActions: {
    display: "flex",
    gap: 10,
    padding: "16px 24px",
    borderTop: "1px solid var(--border)",
    background: "var(--card-muted)",
  },
  btnPrimary: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "12px 20px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  btnSecondary: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "12px 20px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--card)",
    color: "var(--foreground)",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  btnSuccess: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "12px 20px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, var(--success), #059669)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  progressContainer: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderRadius: 10,
    background: "rgba(0, 212, 255, 0.1)",
    marginTop: 12,
  },
  progressText: {
    fontSize: 13,
    color: "var(--accent)",
    fontWeight: 500,
  },
  tipCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    padding: 20,
    borderRadius: 16,
    background: "linear-gradient(135deg, rgba(0, 51, 160, 0.05), rgba(0, 212, 255, 0.05))",
    border: "1px solid var(--border)",
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
  tipContent: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--foreground)",
    margin: 0,
  },
  tipDesc: {
    fontSize: 14,
    color: "var(--muted)",
    margin: 0,
    lineHeight: 1.5,
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   DOCUMENT CARD COMPONENT
───────────────────────────────────────────────────────────────────────────── */
function DocumentCard({
  slot,
  current,
  busy,
  retrainBusy,
  onUpload,
  onRetrain,
  disabled,
}: {
  slot: DocSlot;
  current: ExistingDoc | null | undefined;
  busy: boolean;
  retrainBusy: boolean;
  onUpload: (file: File | null) => void;
  onRetrain: () => void;
  disabled: boolean;
}) {
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const triggerFilePicker = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    onUpload(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    onUpload(file ?? null);
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>, active: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setDragActive(active);
  };

  const status = (current?.indexingStatus || "not_indexed").toLowerCase();
  const isTraining = status === "queued" || status === "indexing" || retrainBusy;
  const isIndexed = status === "indexed";
  const isFailed = status === "failed";
  const canRetrain = Boolean(current) && !disabled && !isTraining;

  const getStatusBadge = () => {
    if (isTraining) {
      return {
        bg: "rgba(0, 212, 255, 0.15)",
        color: "var(--accent)",
        text: "Training...",
        icon: Icons.loader,
      };
    }
    if (isIndexed) {
      return {
        bg: "rgba(16, 185, 129, 0.15)",
        color: "var(--success)",
        text: "Trained",
        icon: Icons.check,
      };
    }
    if (isFailed) {
      return {
        bg: "rgba(239, 68, 68, 0.15)",
        color: "var(--danger)",
        text: "Failed",
        icon: Icons.alert,
      };
    }
    if (current) {
      return {
        bg: "rgba(245, 158, 11, 0.15)",
        color: "#F59E0B",
        text: "Needs Training",
        icon: Icons.refresh,
      };
    }
    return {
      bg: "var(--card-muted)",
      color: "var(--muted)",
      text: "Not Uploaded",
      icon: null,
    };
  };

  const statusBadge = getStatusBadge();
  const iconColor = DOC_SLOT_COLORS[slot.key];

  return (
    <div style={styles.card}>
      {/* Card Header */}
      <div style={styles.cardHeader}>
        <div style={{ ...styles.cardIcon, background: iconColor }}>
          {DOC_SLOT_ICONS[slot.key]}
        </div>
        <div style={styles.cardInfo}>
          <h3 style={styles.cardTitle}>{slot.title}</h3>
          <p style={styles.cardHint}>{slot.hint}</p>
        </div>
        <div
          style={{
            ...styles.cardStatus,
            background: statusBadge.bg,
            color: statusBadge.color,
          }}
        >
          {statusBadge.icon}
          {statusBadge.text}
        </div>
      </div>

      {/* Card Body - Dropzone */}
      <div style={styles.cardBody}>
        <div
          onDragEnter={(e) => handleDrag(e, true)}
          onDragOver={(e) => handleDrag(e, true)}
          onDragLeave={(e) => handleDrag(e, false)}
          onDrop={handleDrop}
          onClick={triggerFilePicker}
          style={{
            ...styles.dropzone,
            ...(dragActive ? styles.dropzoneActive : {}),
            ...(disabled ? styles.dropzoneDisabled : {}),
          }}
        >
          <div style={styles.dropzoneIcon}>{Icons.cloud}</div>
          <p style={styles.dropzoneTitle}>
            {dragActive ? "Drop file here" : "Drag & drop your file here"}
          </p>
          <p style={styles.dropzoneHint}>
            or click to browse • {slot.accept.split(",").join(", ")}
          </p>
        </div>

        {/* Current File Info */}
        {current && (
          <div style={styles.fileInfo}>
            <div style={styles.fileIcon}>{Icons.file}</div>
            <div style={styles.fileDetails}>
              <span style={styles.fileName}>{current.name}</span>
              <span style={styles.fileSize}>
                {(current.size / 1024).toFixed(1)} KB
                {current.uploadedAt && (
                  <> • Uploaded {new Date(current.uploadedAt).toLocaleDateString()}</>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Training Progress */}
        {isTraining && (
          <div style={styles.progressContainer}>
            {Icons.loader}
            <span style={styles.progressText}>
              Training AI on this document...
            </span>
          </div>
        )}

        {/* Error Message */}
        {current?.lastError && (
          <div style={styles.errorText}>
            {Icons.alert}
            <span>{current.lastError}</span>
          </div>
        )}
      </div>

      {/* Card Actions */}
      <div style={styles.cardActions}>
        <button
          style={{
            ...styles.btnSecondary,
            ...(disabled || busy ? styles.btnDisabled : {}),
          }}
          disabled={disabled || busy}
          onClick={(e) => {
            e.stopPropagation();
            triggerFilePicker();
          }}
        >
          {Icons.upload}
          {current ? "Replace" : "Upload"}
        </button>
        <button
          style={{
            ...(isIndexed ? styles.btnSuccess : styles.btnPrimary),
            ...(!canRetrain ? styles.btnDisabled : {}),
          }}
          disabled={!canRetrain}
          onClick={(e) => {
            e.stopPropagation();
            onRetrain();
          }}
        >
          {isTraining ? (
            <>
              {Icons.loader}
              Training...
            </>
          ) : isIndexed ? (
            <>
              {Icons.check}
              Trained
            </>
          ) : (
            <>
              {Icons.refresh}
              Train AI
            </>
          )}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={slot.accept}
        onChange={handleFileChange}
        style={{ display: "none" }}
        disabled={disabled}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN UPLOAD CONTENT
───────────────────────────────────────────────────────────────────────────── */
function UploadContent() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingMap>({});
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [retrainBusy, setRetrainBusy] = useState<DocType | null>(null);
  const toast = useToast();

  const retrainMutation = trpc.rag.enqueueRetrain.useMutation();
  const pollingRef = useState(() => new Map<DocType, number>())[0];

  useEffect(() => {
    try {
      const auth = getFirebaseAuth();
      const u = auth.currentUser;
      setUserEmail(u?.email ?? null);
    } catch {}

    const fetchExisting = async () => {
      try {
        setBusy(true);
        const auth = getFirebaseAuth();
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`/api/upload/docs`, {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load existing docs");
        setExisting(json.files || {});
        setBusinessId(json.businessId ?? null);
      } catch (e: any) {
        setError(e?.message || "Failed to load existing docs");
      } finally {
        setBusy(false);
      }
    };

    fetchExisting();

    return () => {
      for (const id of pollingRef.values()) window.clearInterval(id);
      pollingRef.clear();
    };
  }, [userEmail, pollingRef]);

  const onUpload = useCallback(async (docType: DocType, file: File | null) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("docType", docType);
      const auth = getFirebaseAuth();
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/upload/docs", {
        method: "POST",
        body: form,
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setExisting((prev) => ({ ...prev, [docType]: json.file }));
      toast.show({
        type: "success",
        title: "File uploaded",
        message: `${file.name} uploaded successfully`,
        durationMs: 3000,
      });
    } catch (e: any) {
      setError(e?.message || "Upload failed");
      toast.show({
        type: "error",
        title: "Upload failed",
        message: e?.message || "Upload failed",
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const retrain = useCallback(async (docType: DocType) => {
    setRetrainBusy(docType);
    setError(null);

    const existingPoll = pollingRef.get(docType);
    if (existingPoll) {
      window.clearInterval(existingPoll);
      pollingRef.delete(docType);
    }

    setExisting((prev) => {
      const cur = prev[docType];
      if (!cur) return prev;
      return { ...prev, [docType]: { ...cur, indexingStatus: "queued", lastError: null } };
    });

    const toastId = toast.show({
      type: "progress",
      title: "Training started",
      message: `Training AI on ${DOC_SLOTS.find(s => s.key === docType)?.title || docType}...`,
    });

    try {
      if (!userEmail) throw new Error("Missing user email");
      await retrainMutation.mutateAsync({ email: userEmail, docType });

      const pollId = window.setInterval(async () => {
        try {
          const auth = getFirebaseAuth();
          const token = await auth.currentUser?.getIdToken();
          const res = await fetch(`/api/upload/docs`, {
            headers: token ? { authorization: `Bearer ${token}` } : undefined,
          });
          const body = await res.json();
          if (!res.ok) return;

          const next: ExistingMap = body.files || {};
          setExisting(next);

          const s = (next?.[docType]?.indexingStatus || "").toLowerCase();
          if (s === "indexed") {
            toast.update(toastId, {
              type: "success",
              title: "Training complete",
              message: `AI trained successfully on ${DOC_SLOTS.find(slot => slot.key === docType)?.title || docType}`,
              durationMs: 4000,
            });
            window.clearInterval(pollId);
            pollingRef.delete(docType);
          } else if (s === "failed") {
            toast.update(toastId, {
              type: "error",
              title: "Training failed",
              message: next?.[docType]?.lastError || "Training failed. Please try again.",
              durationMs: 7000,
            });
            window.clearInterval(pollId);
            pollingRef.delete(docType);
          } else {
            toast.update(toastId, {
              type: "progress",
              title: "Training in progress",
              message: `Processing ${DOC_SLOTS.find(slot => slot.key === docType)?.title || docType}...`,
            });
          }
        } catch {
          // ignore transient polling errors
        }
      }, 1500);

      pollingRef.set(docType, pollId);
    } catch (e: any) {
      setError(e?.message || "Retrain failed");
      toast.update(toastId, {
        type: "error",
        title: "Unable to start training",
        message: e?.message || "Retrain failed",
        durationMs: 7000,
      });
    } finally {
      setRetrainBusy(null);
    }
  }, [userEmail, retrainMutation, pollingRef, toast]);

  // Stats calculation
  const stats = {
    uploaded: Object.values(existing).filter(Boolean).length,
    trained: Object.values(existing).filter((d) => d?.indexingStatus === "indexed").length,
    total: DOC_SLOTS.length,
  };

  return (
    <div style={styles.page}>
      {/* Tip Card */}
      <div style={styles.tipCard}>
        <div style={styles.tipIcon}>{Icons.bot}</div>
        <div style={styles.tipContent}>
          <p style={styles.tipTitle}>Pro Tip: Better documents = smarter AI</p>
          <p style={styles.tipDesc}>
            Upload detailed documents with clear information. Include FAQs, product details, 
            policies, and example conversations. After uploading, click &quot;Train AI&quot; to 
            process each document.
          </p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div style={styles.errorText}>
          {Icons.alert}
          <span>{error}</span>
        </div>
      )}

      {/* Document Cards Grid */}
      <div style={styles.grid}>
        {DOC_SLOTS.map((slot) => (
          <DocumentCard
            key={slot.key}
            slot={slot}
            current={existing[slot.key]}
            busy={busy && retrainBusy !== slot.key}
            retrainBusy={retrainBusy === slot.key}
            onUpload={(file) => onUpload(slot.key, file)}
            onRetrain={() => retrain(slot.key)}
            disabled={!businessId}
          />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE EXPORT
───────────────────────────────────────────────────────────────────────────── */
export default function PortalUploadPage() {
  return (
    <PortalAuthProvider>
      <UploadContent />
    </PortalAuthProvider>
  );
}
