"use client";

type Props = { message: string | null };

export function RetrainMessage({ message }: Props) {
  if (!message) return null;
  return <p style={{ marginTop: 12, color: "var(--brand)" }}>{message}</p>;
}
