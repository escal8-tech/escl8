"use client";

type Props = {
  businessId: string | null;
  userEmail: string | null;
};

export function UploadHeader({ businessId, userEmail }: Props) {
  return (
    <header>
      <h1>Upload training documents</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Upload the five key document types below. You can re-upload to replace. Then click Retrain to re-index only that document type for faster updates.
      </p>
      <div style={{ marginTop: 16 }}>
        <p className="muted">
          Business ID / Namespace: <span style={{ fontWeight: 600 }}>{businessId === null ? (userEmail ? "-" : "loading…") : businessId}</span>
        </p>
      </div>
    </header>
  );
}
