"use client";

type PendingDocumentTraining = {
  businessId: string;
  jobId: string;
  docType: string;
  documentName?: string | null;
  requestedAt: number;
};

const STORAGE_KEY = "portal.document-training.pending.v1";
const MAX_PENDING_AGE_MS = 6 * 60 * 60 * 1000;

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function readPendingMap(): Record<string, PendingDocumentTraining> {
  if (!canUseSessionStorage()) return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PendingDocumentTraining> | null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePendingMap(value: Record<string, PendingDocumentTraining>) {
  if (!canUseSessionStorage()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures; realtime toasts are best-effort.
  }
}

function pruneExpired(
  input: Record<string, PendingDocumentTraining>,
  now = Date.now(),
): Record<string, PendingDocumentTraining> {
  const next: Record<string, PendingDocumentTraining> = {};

  for (const [jobId, entry] of Object.entries(input)) {
    if (!entry || typeof entry !== "object") continue;
    const requestedAt = Number(entry.requestedAt ?? 0);
    if (!requestedAt || now - requestedAt > MAX_PENDING_AGE_MS) continue;
    if (!entry.businessId || !entry.jobId || !entry.docType) continue;

    next[jobId] = {
      businessId: String(entry.businessId),
      jobId: String(entry.jobId),
      docType: String(entry.docType),
      documentName: entry.documentName ? String(entry.documentName) : null,
      requestedAt,
    };
  }

  return next;
}

export function rememberPendingDocumentTraining(input: {
  businessId: string;
  jobId: string;
  docType: string;
  documentName?: string | null;
}) {
  const pending = pruneExpired(readPendingMap());
  pending[input.jobId] = {
    businessId: input.businessId,
    jobId: input.jobId,
    docType: input.docType,
    documentName: input.documentName ?? null,
    requestedAt: Date.now(),
  };
  writePendingMap(pending);
}

export function takePendingDocumentTraining(jobId: string, businessId?: string): PendingDocumentTraining | null {
  if (!jobId) return null;
  const pending = pruneExpired(readPendingMap());
  const match = pending[jobId] ?? null;
  if (!match) {
    writePendingMap(pending);
    return null;
  }
  if (businessId && match.businessId !== businessId) {
    writePendingMap(pending);
    return null;
  }
  delete pending[jobId];
  writePendingMap(pending);
  return match;
}
