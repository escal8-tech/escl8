"use client";

import { useToast } from "@/components/ToastProvider";
import { getDocTitle, INDEXING_STATUS, normalizeIndexingStatus, type DocType } from "@/lib/rag-documents";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { takePendingDocumentTraining } from "@/app/portal/lib/documentTrainingRealtime";

function trimMessage(value: string, limit = 180): string {
  const normalized = value.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}...`;
}

export default function PortalLiveDocumentToasts() {
  const toast = useToast();

  useLivePortalEvents({
    onEvent: (event) => {
      if (event.entity !== "document" || event.op !== "upsert") return;

      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const jobId = typeof payload.ragJobId === "string" ? payload.ragJobId : "";
      if (!jobId) return;

      const doc = payload.document as Record<string, unknown> | undefined;
      const docType = typeof doc?.docType === "string" ? doc.docType : "";
      if (!docType) return;

      const status = normalizeIndexingStatus(doc?.indexingStatus);
      if (status !== INDEXING_STATUS.INDEXED && status !== INDEXING_STATUS.FAILED) return;

      const pending = takePendingDocumentTraining(jobId, event.businessId);
      if (!pending) return;

      const title = getDocTitle(pending.docType as DocType);
      const name = pending.documentName || (typeof doc?.name === "string" ? doc.name : null);

      if (status === INDEXING_STATUS.INDEXED) {
        toast.show({
          type: "success",
          title: "Training complete",
          message: name
            ? `${title} is indexed and ready. Source: ${name}.`
            : `${title} is indexed and ready.`,
          durationMs: 4500,
        });
        return;
      }

      const lastError =
        typeof doc?.lastError === "string" && doc.lastError.trim()
          ? trimMessage(doc.lastError)
          : "Training failed. Please retry after checking the document.";

      toast.show({
        type: "error",
        title: "Training failed",
        message: `${title}: ${lastError}`,
        durationMs: 7000,
      });
    },
  });

  return null;
}
