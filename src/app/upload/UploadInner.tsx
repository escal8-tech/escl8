"use client";
import { useCallback, useMemo, useState } from "react";

type Uploaded = { name: string; size: number };

export default function UploadInner() {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Uploaded[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setResult(json.files || []);
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      await onFiles(e.dataTransfer.files);
    },
    [onFiles]
  );

  const accept = useMemo(
    () => [".pdf", ".txt", ".doc", ".docx"].join(","),
    []
  );

  return (
    <div className="container" style={{ padding: "40px 0 80px" }}>
      <h1>Upload documents</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Supported: PDF, TXT, DOC, DOCX. We’ll index these for your AI agent.
      </p>

      <div style={{ height: 20 }} />

      <div
        className="glass"
        onDragEnter={() => setDragOver(true)}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          padding: 32,
          borderStyle: "dashed",
          borderWidth: 2,
          borderColor: dragOver ? "var(--brand)" : "var(--border)",
          textAlign: "center",
          transition: "border-color 0.2s ease",
        }}
      >
        <p style={{ fontWeight: 600 }}>Drag & drop files here</p>
        <p className="muted">or</p>
        <label className="btn" style={{ cursor: "pointer" }}>
          Choose files
          <input
            type="file"
            accept={accept}
            multiple
            onChange={(e) => onFiles(e.target.files)}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {busy && (
        <p style={{ marginTop: 16 }} className="muted">
          Uploading…
        </p>
      )}

      {error && (
        <p style={{ marginTop: 16, color: "crimson" }}>
          {error}
        </p>
      )}

      {result.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Uploaded</h3>
          <ul style={{ marginTop: 8 }}>
            {result.map((f) => (
              <li key={f.name} className="muted">
                {f.name} — {(f.size / 1024).toFixed(1)} KB
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
