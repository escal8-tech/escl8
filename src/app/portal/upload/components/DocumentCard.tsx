"use client";

import { useRef, useState } from "react";
import { DocSlot } from "../types";

type Props = {
  slot: DocSlot;
  current: { name: string; size: number; indexingStatus?: string; lastError?: string | null } | null | undefined;
  busy: boolean;
  retrainBusy: boolean;
  onUpload: (file: File | null) => void;
  onRetrain: () => void;
  disabled: boolean;
};

export function DocumentCard({ slot, current, busy, retrainBusy, onUpload, onRetrain, disabled }: Props) {
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const triggerFilePicker = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    onUpload(file);
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

  const dropBorder = dragActive ? "2px dashed #60a5fa" : "2px dashed var(--border)";
  const dropBg = dragActive ? "rgba(37, 99, 235, 0.06)" : "rgba(255,255,255,0.03)";

  const status = (current?.indexingStatus || "not_indexed").toLowerCase();
  const isTraining = status === "queued" || status === "indexing" || retrainBusy;
  const isIndexed = status === "indexed";
  const canRetrain = Boolean(current) && !disabled && !isIndexed && !isTraining;

  return (
    <div className="glass" style={{ padding: 16, borderRadius: 16 }}>
      <h3 style={{ marginBottom: 6 }}>{slot.title}</h3>
      <p className="muted" style={{ marginBottom: 12 }}>{slot.hint}</p>

      <div
        onDragEnter={(e) => handleDrag(e, true)}
        onDragOver={(e) => handleDrag(e, true)}
        onDragLeave={(e) => handleDrag(e, false)}
        onDrop={handleDrop}
        style={{
          border: dropBorder,
          borderRadius: 14,
          background: dropBg,
          padding: 16,
          minHeight: 180,
          display: "grid",
          gap: 12,
          alignContent: "space-between",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "border-color 120ms ease, background 120ms ease",
        }}
        onClick={triggerFilePicker}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Drag & drop your file here</p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>PDF, DOCX, TXT, CSV (per slot rules). Or click to browse.</p>
          <div style={{ marginTop: 6 }}>
            {current ? (
              <p className="muted" style={{ margin: 0 }}>Current: {current.name} — {(current.size / 1024).toFixed(1)} KB</p>
            ) : (
              <p className="muted" style={{ margin: 0 }}>No file uploaded yet</p>
            )}
          </div>
          {current?.lastError ? (
            <p style={{ margin: 0, fontSize: 13, color: "crimson" }}>Last training error: {current.lastError}</p>
          ) : null}
          {busy && <p className="muted" style={{ margin: 0 }}>Working…</p>}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            style={{ opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
            disabled={disabled || busy}
            onClick={(e) => {
              e.stopPropagation();
              triggerFilePicker();
            }}
          >
            {current ? "Re-upload" : "Upload"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canRetrain}
            onClick={(e) => {
              e.stopPropagation();
              onRetrain();
            }}
            style={{ opacity: !canRetrain ? 0.6 : 1 }}
          >
            {isTraining ? "Training…" : isIndexed ? "Trained" : "Retrain"}
          </button>
        </div>
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
