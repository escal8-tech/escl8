"use client";

export function TooltipIcon({ title }: { title: string }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: 999,
        border: "1px solid var(--border)",
        color: "var(--muted)",
        fontSize: 11,
        lineHeight: 1,
        marginLeft: 8,
        userSelect: "none",
      }}
      aria-label={title}
    >
      i
    </span>
  );
}