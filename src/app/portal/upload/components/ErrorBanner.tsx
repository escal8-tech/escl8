"use client";

type Props = {
  message: string | null;
};

export function ErrorBanner({ message }: Props) {
  if (!message) return null;
  return (
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
      <div style={{ marginTop: 6 }}>{message}</div>
    </div>
  );
}
