"use client";

import { DocSlot } from "../types";

type Props = {
  slot: DocSlot;
  current: { name: string; size: number } | null | undefined;
  busy: boolean;
  retrainBusy: boolean;
  onUpload: (file: File | null) => void;
  onRetrain: () => void;
  disabled: boolean;
};

export function DocumentCard({ slot, current, busy, retrainBusy, onUpload, onRetrain, disabled }: Props) {
  return (
    <div className="glass" style={{ padding: 16 }}>
      <h3 style={{ marginBottom: 6 }}>{slot.title}</h3>
      <p className="muted" style={{ marginBottom: 12 }}>{slot.hint}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label className="btn" style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}>
          {current ? "Re-upload" : "Upload"}
          <input
            type="file"
            accept={slot.accept}
            onChange={(e) => onUpload(e.target.files?.[0] || null)}
            style={{ display: "none" }}
            disabled={disabled}
          />
        </label>
        <button className="btn" onClick={onRetrain} disabled={retrainBusy || !current || disabled}>
          {retrainBusy ? "Retraining…" : "Retrain"}
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        {current ? (
          <p className="muted">Current: {current.name} — {(current.size / 1024).toFixed(1)} KB</p>
        ) : (
          <p className="muted">No file uploaded yet</p>
        )}
      </div>
      {busy && <p className="muted" style={{ marginTop: 8 }}>Working…</p>}
    </div>
  );
}
