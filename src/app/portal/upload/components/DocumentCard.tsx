"use client";

import { useRef, useState } from "react";
import { ExistingDoc, type DocSlot } from "../types";
import { INDEXING_STATUS, isIndexedIndexingStatus, isTrainingIndexingStatus, normalizeIndexingStatus } from "@/lib/rag-documents";
import { DOC_SLOT_ICONS, UploadIcons, uploadStyles } from "./UploadPageUI";

type Props = {
  slot: DocSlot;
  current: ExistingDoc | null | undefined;
  compact: boolean;
  busy: boolean;
  retrainBusy: boolean;
  onUpload: (file: File | null) => void;
  onRetrain: () => void;
  disabled: boolean;
};

export function DocumentCard({
  slot,
  current,
  compact,
  busy,
  retrainBusy,
  onUpload,
  onRetrain,
  disabled,
}: Props) {
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

  const status = normalizeIndexingStatus(current?.indexingStatus || INDEXING_STATUS.NOT_INDEXED);
  const isTraining = isTrainingIndexingStatus(status) || retrainBusy;
  const isIndexed = isIndexedIndexingStatus(status);
  const isFailed = status === INDEXING_STATUS.FAILED;
  const canRetrain = Boolean(current) && !disabled && !isTraining;

  const statusBadge = (() => {
    if (isTraining) {
      return { bg: "rgba(0, 212, 255, 0.15)", color: "var(--accent)", text: "Training...", icon: UploadIcons.loader };
    }
    if (isIndexed) {
      return { bg: "rgba(16, 185, 129, 0.15)", color: "var(--success)", text: "Trained", icon: UploadIcons.check };
    }
    if (isFailed) {
      return { bg: "rgba(239, 68, 68, 0.15)", color: "var(--danger)", text: "Failed", icon: UploadIcons.alert };
    }
    if (current) {
      return { bg: "rgba(245, 158, 11, 0.15)", color: "#F59E0B", text: "Needs Training", icon: UploadIcons.refresh };
    }
    return { bg: "var(--card-muted)", color: "var(--muted)", text: "Not Uploaded", icon: null };
  })();

  return (
    <div style={uploadStyles.card}>
      <div
        style={{
          ...uploadStyles.cardHeader,
          padding: compact ? "18px" : uploadStyles.cardHeader.padding,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div style={uploadStyles.cardIcon}>{DOC_SLOT_ICONS[slot.key]}</div>
        <div style={{ ...uploadStyles.cardInfo, minWidth: 0, flex: "1 1 180px" }}>
          <h3 style={uploadStyles.cardTitle}>{slot.title}</h3>
          <p style={uploadStyles.cardHint}>{slot.hint}</p>
        </div>
        <div
          style={{
            ...uploadStyles.cardStatus,
            background: statusBadge.bg,
            color: statusBadge.color,
            marginLeft: "auto",
          }}
        >
          {statusBadge.icon}
          {statusBadge.text}
        </div>
      </div>

      <div
        style={{
          ...uploadStyles.cardBody,
          padding: compact ? 18 : uploadStyles.cardBody.padding,
        }}
      >
        <div
          onDragEnter={(e) => handleDrag(e, true)}
          onDragOver={(e) => handleDrag(e, true)}
          onDragLeave={(e) => handleDrag(e, false)}
          onDrop={handleDrop}
          onClick={triggerFilePicker}
          style={{
            ...uploadStyles.dropzone,
            ...(dragActive ? uploadStyles.dropzoneActive : {}),
            ...(disabled ? uploadStyles.dropzoneDisabled : {}),
          }}
        >
          <div style={uploadStyles.dropzoneIcon}>{UploadIcons.cloud}</div>
          <p style={uploadStyles.dropzoneTitle}>
            {dragActive ? "Drop file here" : "Drag & drop your file here"}
          </p>
          <p style={uploadStyles.dropzoneHint}>
            or click to browse • {slot.accept.split(",").join(", ")}
          </p>
        </div>

        <div style={uploadStyles.statusArea}>
          {current ? (
            <div style={{ ...uploadStyles.fileInfo, alignItems: "flex-start" }}>
              <div style={uploadStyles.fileIcon}>{UploadIcons.file}</div>
              <div style={uploadStyles.fileDetails}>
                <span style={uploadStyles.fileName}>{current.name}</span>
                <span style={uploadStyles.fileSize}>
                  {(current.size / 1024).toFixed(1)} KB
                  {current.uploadedAt ? <> • Uploaded {new Date(current.uploadedAt).toLocaleDateString()}</> : null}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ ...uploadStyles.fileInfo, alignItems: "flex-start", visibility: "hidden" }}>
              <div style={uploadStyles.fileIcon}>{UploadIcons.file}</div>
              <div style={uploadStyles.fileDetails}>
                <span style={uploadStyles.fileName}>Placeholder</span>
                <span style={uploadStyles.fileSize}>0.0 KB</span>
              </div>
            </div>
          )}

          {isTraining ? (
            <div style={uploadStyles.progressContainer}>
              {UploadIcons.loader}
              <span style={uploadStyles.progressText}>Training AI on this document...</span>
            </div>
          ) : (
            <div style={{ ...uploadStyles.progressContainer, visibility: "hidden" }}>
              {UploadIcons.loader}
              <span style={uploadStyles.progressText}>Training AI on this document...</span>
            </div>
          )}

          {current?.lastError ? (
            <div style={uploadStyles.errorText}>
              {UploadIcons.alert}
              <span>{current.lastError}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          ...uploadStyles.cardActions,
          flexDirection: compact ? "column" : "row",
          padding: compact ? "0 18px 18px" : uploadStyles.cardActions.padding,
        }}
      >
        <button
          style={{
            ...uploadStyles.btnSecondary,
            ...(disabled || busy ? uploadStyles.btnDisabled : {}),
            width: compact ? "100%" : undefined,
          }}
          disabled={disabled || busy}
          onClick={(e) => {
            e.stopPropagation();
            triggerFilePicker();
          }}
        >
          {UploadIcons.upload}
          {current ? "Replace" : "Upload"}
        </button>
        <button
          style={{
            ...(isIndexed ? uploadStyles.btnSuccess : uploadStyles.btnPrimary),
            ...(!canRetrain ? uploadStyles.btnDisabled : {}),
            width: compact ? "100%" : undefined,
          }}
          disabled={!canRetrain}
          onClick={(e) => {
            e.stopPropagation();
            onRetrain();
          }}
        >
          {isTraining ? (
            <>
              {UploadIcons.loader}
              Training...
            </>
          ) : isIndexed ? (
            <>
              {UploadIcons.check}
              Trained
            </>
          ) : (
            <>
              {UploadIcons.refresh}
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
