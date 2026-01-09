"use client";
import { useEffect, useState } from "react";
import PortalAuthProvider from "@/components/PortalAuthProvider";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { UploadHeader } from "./components/UploadHeader";
import { DocumentCard } from "./components/DocumentCard";
import { ErrorBanner } from "./components/ErrorBanner";
import { RetrainMessage } from "./components/RetrainMessage";
import { DocSlot, DocType, ExistingMap } from "./types";
import { trpc } from "@/utils/trpc";
import { useToast } from "@/components/ToastProvider";

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

function UploadContent() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingMap>({});
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [retrainBusy, setRetrainBusy] = useState<DocType | null>(null);
  const [retrainMsg, setRetrainMsg] = useState<string | null>(null);
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
        const res = await fetch(`/api/upload/docs`, { headers: userEmail ? { "x-user-email": userEmail } : undefined });
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

    // Clear any existing poller for this slot.
    const existingPoll = pollingRef.get(docType);
    if (existingPoll) {
      window.clearInterval(existingPoll);
      pollingRef.delete(docType);
    }

    // Optimistically mark as queued in UI.
    setExisting((prev) => {
      const cur = prev[docType];
      if (!cur) return prev;
      return { ...prev, [docType]: { ...cur, indexingStatus: "queued", lastError: null } };
    });

    const toastId = toast.show({
      type: "progress",
      title: "Training started",
      message: `Queued retrain for ${docType}…`,
    });

    try {
      if (!userEmail) throw new Error("Missing user email");
      const json = await retrainMutation.mutateAsync({ email: userEmail, docType });
      setRetrainMsg(`Queued retrain for ${docType} (job ${json.jobId})`);

      // Poll doc status via /api/upload/docs until indexed/failed.
      const pollId = window.setInterval(async () => {
        try {
          const res = await fetch(`/api/upload/docs`, {
            headers: userEmail ? { "x-user-email": userEmail } : undefined,
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
              message: `${docType} trained successfully.`,
              durationMs: 3500,
            });
            window.clearInterval(pollId);
            pollingRef.delete(docType);
          } else if (s === "failed") {
            toast.update(toastId, {
              type: "error",
              title: "Training failed",
              message: next?.[docType]?.lastError || `${docType} training failed. Check logs.`,
              durationMs: 7000,
            });
            window.clearInterval(pollId);
            pollingRef.delete(docType);
          } else {
            toast.update(toastId, {
              type: "progress",
              title: "Training in progress",
              message: `Status: ${s || "queued"} (${docType})`,
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
  };

  return (
    <div className="container" style={{ padding: "32px 0 80px", display: "grid", gap: 16 }}>
      <UploadHeader businessId={businessId} userEmail={userEmail} />

      <div className="grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
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

      {busy && !retrainBusy && <p className="muted" style={{ marginTop: 12 }}>Working…</p>}
      <ErrorBanner message={error} />
      <RetrainMessage message={retrainMsg} />
    </div>
  );
}

export default function PortalUploadPage() {
  return (
    <PortalAuthProvider>
      <UploadContent />
    </PortalAuthProvider>
  );
}
