"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useIsMobileViewport } from "@/app/portal/hooks/useIsMobileViewport";
import { trpc } from "@/utils/trpc";
import { useToast } from "@/components/ToastProvider";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { fetchWithFirebaseAuth } from "@/lib/client-auth-ops";
import { recordClientBusinessEvent } from "@/lib/client-business-monitoring";
import {
  DOC_SLOTS,
  INDEXING_STATUS,
  getDocTitle,
  normalizeIndexingStatus,
} from "@/lib/rag-documents";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { rememberPendingDocumentTraining } from "@/app/portal/lib/documentTrainingRealtime";
import type { DocType, ExistingMap } from "../types";
import { DocumentCard } from "./DocumentCard";
import { getEmailDomain, UploadIcons, uploadStyles } from "./UploadPageUI";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function UploadContent() {
  const isMobile = useIsMobileViewport();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingMap>({});
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [retrainBusy, setRetrainBusy] = useState<DocType | null>(null);
  const toast = useToast();
  const observedStatusRef = useRef(new Map<DocType, string>());
  const pendingTrainingDocsRef = useRef(new Set<DocType>());

  const retrainMutation = trpc.rag.enqueueRetrain.useMutation();
  const route = pathname || "/upload";
  const emailDomain = getEmailDomain(userEmail);

  const fetchExisting = useCallback(async () => {
    try {
      setBusy(true);
      const res = await fetchWithFirebaseAuth("/api/upload/docs", undefined, {
        action: "portal.upload.fetchExisting",
        area: "documents",
        missingConfigEvent: "document.list_failed",
        missingSessionEvent: "document.list_session_missing",
        requestFailureEvent: "document.list_failed",
        tokenFailureEvent: "document.list_failed",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load existing docs");
      setExisting(json.files || {});
      setBusinessId(json.businessId ?? null);
    } catch (error) {
      setError(getErrorMessage(error, "Failed to load existing docs"));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    setUserEmail(user?.email ?? null);
  }, []);

  useEffect(() => {
    if (!userEmail) return;
    void fetchExisting();
  }, [userEmail, fetchExisting]);

  useLivePortalEvents({
    onCatchup: fetchExisting,
    onEvent: (event) => {
      if (event.entity !== "document") return;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const doc = payload.document as Record<string, unknown> | undefined;
      const docType = typeof doc?.docType === "string" ? (doc.docType as DocType) : null;
      if (!docType) return;
      setExisting((prev) => ({
        ...prev,
        [docType]: {
          name: String(doc?.name ?? "latest"),
          size: Number(doc?.size ?? 0),
          indexingStatus: normalizeIndexingStatus(doc?.indexingStatus),
          lastIndexedAt: doc?.lastIndexedAt ? String(doc.lastIndexedAt) : null,
          lastError: doc?.lastError ? String(doc.lastError) : null,
          uploadedAt: doc?.uploadedAt ? String(doc.uploadedAt) : null,
        },
      }));
    },
  });

  useEffect(() => {
    for (const slot of DOC_SLOTS) {
      const docType = slot.key;
      const currentDoc = existing?.[docType];
      const currentStatus = normalizeIndexingStatus(currentDoc?.indexingStatus);
      const previousStatus = observedStatusRef.current.get(docType);

      if (previousStatus === currentStatus) continue;

      if (pendingTrainingDocsRef.current.has(docType)) {
        if (currentStatus === INDEXING_STATUS.INDEXED) {
          pendingTrainingDocsRef.current.delete(docType);
          recordClientBusinessEvent({
            event: "document.training_completed",
            action: "portal.upload.train",
            area: "documents",
            level: "info",
            outcome: "success",
            route,
            attributes: {
              business_id: businessId,
              doc_type: docType,
              document_name: currentDoc?.name,
              email_domain: emailDomain,
              last_indexed_at: currentDoc?.lastIndexedAt,
            },
          });
        } else if (currentStatus === INDEXING_STATUS.FAILED) {
          pendingTrainingDocsRef.current.delete(docType);
          recordClientBusinessEvent({
            event: "document.training_failed",
            action: "portal.upload.train",
            area: "documents",
            level: "error",
            outcome: "flow_broken",
            route,
            error: new Error(currentDoc?.lastError || `${getDocTitle(docType)} training failed.`),
            captureInSentry: true,
            attributes: {
              business_id: businessId,
              doc_type: docType,
              document_name: currentDoc?.name,
              email_domain: emailDomain,
              last_error: currentDoc?.lastError,
            },
          });
        }
      }

      observedStatusRef.current.set(docType, currentStatus);
    }
  }, [businessId, emailDomain, existing, route]);

  const onUpload = useCallback(async (docType: DocType, file: File | null) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("docType", docType);
      const res = await fetchWithFirebaseAuth("/api/upload/docs", { method: "POST", body: form }, {
        action: "portal.upload.submit",
        area: "documents",
        attributes: { doc_type: docType },
        missingConfigEvent: "document.upload_failed",
        missingSessionEvent: "document.upload_session_missing",
        requestFailureEvent: "document.upload_failed",
        tokenFailureEvent: "document.upload_failed",
        route,
      });
      const json = await res.json();
      if (!res.ok) {
        const uploadError = new Error(json.error || "Upload failed");
        recordClientBusinessEvent({
          event: "document.upload_rejected",
          action: "portal.upload.submit",
          area: "documents",
          level: res.status >= 500 ? "error" : "warn",
          outcome: res.status >= 500 ? "unexpected_failure" : "handled_failure",
          route,
          error: uploadError,
          captureInSentry: res.status >= 500,
          attributes: {
            business_id: businessId,
            doc_type: docType,
            document_name: file.name,
            email_domain: emailDomain,
            file_size: file.size,
            http_status: res.status,
          },
        });
        throw uploadError;
      }
      setExisting((prev) => ({ ...prev, [docType]: json.file }));
      recordClientBusinessEvent({
        event: "document.upload_succeeded",
        action: "portal.upload.submit",
        area: "documents",
        level: "info",
        outcome: "success",
        route,
        attributes: {
          business_id: businessId,
          doc_type: docType,
          document_name: file.name,
          email_domain: emailDomain,
          file_size: file.size,
          indexing_status: json.file?.indexingStatus,
        },
      });
      toast.show({
        type: "success",
        title: "File uploaded",
        message: `${file.name} uploaded successfully`,
        durationMs: 3000,
      });
    } catch (error) {
      setError(getErrorMessage(error, "Upload failed"));
      toast.show({
        type: "error",
        title: "Upload failed",
        message: getErrorMessage(error, "Upload failed"),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  }, [businessId, emailDomain, route, toast]);

  const retrain = useCallback(async (docType: DocType) => {
    setRetrainBusy(docType);
    setError(null);

    setExisting((prev) => {
      const cur = prev[docType];
      if (!cur) return prev;
      return { ...prev, [docType]: { ...cur, indexingStatus: INDEXING_STATUS.QUEUED, lastError: null } };
    });

    try {
      if (!userEmail) throw new Error("Missing user email");
      const result = await retrainMutation.mutateAsync({ email: userEmail, docType });
      pendingTrainingDocsRef.current.add(docType);
      if (businessId && result?.jobId) {
        rememberPendingDocumentTraining({
          businessId,
          jobId: String(result.jobId),
          docType,
          documentName: existing?.[docType]?.name ?? null,
        });
      }
      recordClientBusinessEvent({
        event: "document.training_requested",
        action: "portal.upload.train",
        area: "documents",
        level: "info",
        outcome: "queued",
        route,
        attributes: {
          business_id: businessId,
          doc_type: docType,
          document_name: existing?.[docType]?.name,
          email_domain: emailDomain,
        },
      });
      toast.show({
        type: "info",
        title: "Training queued",
        message: `Live updates enabled for ${getDocTitle(docType)}. You will get a toast when it finishes.`,
        durationMs: 3500,
      });
    } catch (error) {
      pendingTrainingDocsRef.current.delete(docType);
      setError(getErrorMessage(error, "Retrain failed"));
      recordClientBusinessEvent({
        event: "document.training_request_failed",
        action: "portal.upload.train",
        area: "documents",
        level: "warn",
        outcome: "handled_failure",
        route,
        error: error instanceof Error ? error : new Error(String(error)),
        attributes: {
          business_id: businessId,
          doc_type: docType,
          document_name: existing?.[docType]?.name,
          email_domain: emailDomain,
        },
      });
      toast.show({
        type: "error",
        title: "Unable to start training",
        message: getErrorMessage(error, "Retrain failed"),
        durationMs: 7000,
      });
    } finally {
      setRetrainBusy(null);
    }
  }, [businessId, emailDomain, existing, retrainMutation, route, toast, userEmail]);

  return (
    <div
      style={{
        ...uploadStyles.page,
        padding: isMobile ? "0 12px" : uploadStyles.page.padding,
        gap: isMobile ? 16 : uploadStyles.page.gap,
      }}
    >
      <div
        style={{
          ...uploadStyles.tipCard,
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "flex-start" : "center",
          padding: isMobile ? "18px" : uploadStyles.tipCard.padding,
        }}
      >
        <div style={uploadStyles.tipIcon}>{UploadIcons.bot}</div>
        <div style={uploadStyles.tipContent}>
          <p style={uploadStyles.tipTitle}>Pro Tip: Better documents = smarter AI</p>
          <p style={uploadStyles.tipDesc}>
            Upload detailed documents with clear information. Include FAQs, product details,
            policies, and example conversations. After uploading, click &quot;Train AI&quot; to
            process each document.
          </p>
        </div>
      </div>

      {error ? (
        <div style={uploadStyles.errorText}>
          {UploadIcons.alert}
          <span>{error}</span>
        </div>
      ) : null}

      <div
        style={{
          ...uploadStyles.grid,
          gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : uploadStyles.grid.gridTemplateColumns,
          gap: isMobile ? 16 : uploadStyles.grid.gap,
        }}
      >
        {DOC_SLOTS.map((slot) => (
          <DocumentCard
            key={slot.key}
            slot={slot}
            current={existing[slot.key]}
            compact={isMobile}
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
