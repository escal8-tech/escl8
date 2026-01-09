"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ToastType = "success" | "error" | "info" | "progress";

export type Toast = {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  createdAt: number;
  durationMs?: number; // undefined => sticky until dismissed
};

type ToastInput = Omit<Toast, "id" | "createdAt">;

type ToastContextValue = {
  toasts: Toast[];
  show: (toast: ToastInput) => string;
  update: (id: string, patch: Partial<Omit<Toast, "id" | "createdAt">>) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function toastAccent(type: ToastType) {
  if (type === "error") return "crimson";
  if (type === "success") return "var(--brand)";
  if (type === "progress") return "var(--brand-2)";
  return "var(--muted)";
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      setToasts((prev) => [{ id, createdAt, ...toast }, ...prev].slice(0, 5));

      if (toast.durationMs && toast.durationMs > 0) {
        const t = window.setTimeout(() => dismiss(id), toast.durationMs);
        timers.current.set(id, t);
      }

      return id;
    },
    [dismiss],
  );

  const update = useCallback((id: string, patch: Partial<Omit<Toast, "id" | "createdAt">>) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, show, update, dismiss, dismissAll }),
    [toasts, show, update, dismiss, dismissAll],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions removals"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 100,
          display: "grid",
          gap: 10,
          width: "min(420px, calc(100vw - 32px))",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="glass"
            style={{
              padding: 12,
              borderRadius: 14,
              pointerEvents: "auto",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "grid", gap: 2 }}>
                {t.title ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: toastAccent(t.type),
                        flex: "0 0 auto",
                      }}
                    />
                    <div style={{ fontWeight: 650 }}>{t.title}</div>
                  </div>
                ) : null}
                <div className="muted" style={{ fontSize: 13, lineHeight: 1.35 }}>
                  {t.message}
                </div>
              </div>

              <button
                type="button"
                className="btn"
                onClick={() => dismiss(t.id)}
                style={{ padding: "6px 10px", borderRadius: 10 }}
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
