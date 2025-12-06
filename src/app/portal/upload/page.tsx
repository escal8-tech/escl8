"use client";
import { useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

const DOC_SLOTS: { key: DocType; title: string; hint: string; accept: string }[] = [
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

type ExistingMap = Partial<Record<DocType, { name: string; size: number } | null>>;

function UploadUI() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingMap>({});
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [retrainBusy, setRetrainBusy] = useState<DocType | null>(null);
  const [retrainMsg, setRetrainMsg] = useState<string | null>(null);

  const docKeys = useMemo(() => DOC_SLOTS.map((d) => d.key), []);

  useEffect(() => {
    // Capture logged-in user's email from Firebase
    try {
      const auth = getFirebaseAuth();
      const u = auth.currentUser;
      setUserEmail(u?.email ?? null);
    } catch {}
    const fetchExisting = async () => {
      try {
        setBusy(true);
        const res = await fetch(`/api/upload/docs`, { headers: userEmail ? { "x-user-email": userEmail } : undefined });
  const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load existing docs");
        // json.files: Record<DocType, {name,size} | null>
        setExisting(json.files || {});
  setBusinessId(json.businessId ?? null);
      } catch (e: any) {
        setError(e?.message || "Failed to load existing docs");
      } finally {
        setBusy(false);
      }
    };
    fetchExisting();
  }, [userEmail]);

  const onUpload = async (docType: DocType, file: File | null) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("docType", docType);
  const res = await fetch("/api/upload/docs", { method: "POST", body: form, headers: userEmail ? { "x-user-email": userEmail } : undefined });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setExisting((prev) => ({ ...prev, [docType]: json.file }));
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const retrain = async (docType: DocType) => {
    setRetrainBusy(docType);
    setRetrainMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/rag/retrain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Retrain failed");
      setRetrainMsg(json.message || `Retrained ${docType}`);
    } catch (e: any) {
      setError(e?.message || "Retrain failed");
    } finally {
      setRetrainBusy(null);
    }
  };

  return (
    <div className="container" style={{ padding: "32px 0 80px" }}>
      <h1>Upload training documents</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Upload the five key document types below. You can re-upload to replace. Then click Retrain to re-index only that document type for faster updates.
      </p>

      <div style={{ marginTop: 16 }}>
        <p className="muted">Business ID / Namespace: <span style={{ fontWeight: 600 }}>{businessId === null ? (userEmail ? "-" : "loading…") : businessId}</span></p>
      </div>

      <div style={{ height: 16 }} />

      <div className="grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {DOC_SLOTS.map((slot) => {
          const current = existing[slot.key];
          return (
            <div key={slot.key} className="glass" style={{ padding: 16 }}>
              <h3 style={{ marginBottom: 6 }}>{slot.title}</h3>
              <p className="muted" style={{ marginBottom: 12 }}>{slot.hint}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label className="btn" style={{ cursor: businessId ? "pointer" : "not-allowed", opacity: businessId ? 1 : 0.6 }}>
                  {current ? "Re-upload" : "Upload"}
                  <input
                    type="file"
                    accept={slot.accept}
                    onChange={(e) => onUpload(slot.key, e.target.files?.[0] || null)}
                    style={{ display: "none" }}
                  />
                </label>
                <button
                  className="btn"
                  onClick={() => retrain(slot.key)}
                  disabled={retrainBusy === slot.key || !current || !businessId}
                >
                  {retrainBusy === slot.key ? "Retraining…" : "Retrain"}
                </button>
              </div>
              <div style={{ marginTop: 10 }}>
                {current ? (
                  <p className="muted">Current: {current.name} — {(current.size / 1024).toFixed(1)} KB</p>
                ) : (
                  <p className="muted">No file uploaded yet</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {busy && <p className="muted" style={{ marginTop: 12 }}>Working…</p>}
      {error && (
        <div style={{
          position: "fixed",
          top: 16,
          right: 16,
          padding: "12px 16px",
          border: "2px solid crimson",
          background: "#fff",
          color: "#111",
          borderRadius: 8,
          boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
          zIndex: 1000,
        }}>
          <strong style={{ color: "crimson" }}>Error</strong>
          <div style={{ marginTop: 6 }}>{error}</div>
        </div>
      )}
      {retrainMsg && <p style={{ marginTop: 12, color: "var(--brand)" }}>{retrainMsg}</p>}
    </div>
  );
}

import PortalAuthProvider from "@/components/PortalAuthProvider";

export default function PortalUploadPageWrapper() {
  return (
    <PortalAuthProvider>
  <UploadUI />
    </PortalAuthProvider>
  );
}
