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
          top: 88,
          right: 16,
          zIndex: 5000,
          display: "grid",
          gap: 10,
          width: "min(420px, calc(100vw - 32px))",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: 12,
              borderRadius: 14,
              pointerEvents: "auto",
              display: "grid",
              gap: 6,
              border: "1px solid rgba(255, 255, 255, 0.14)",
              background: "rgba(10, 10, 10, 0.82)",
              backdropFilter: "blur(12px)",
              boxShadow: "0 12px 30px rgba(0, 0, 0, 0.35)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "grid", gap: 2 }}>
                {t.title ? (
                  <div style={{ fontWeight: 650, fontSize: 14, letterSpacing: "-0.01em" }}>{t.title}</div>
                ) : null}
                <div style={{ fontSize: 13, lineHeight: 1.35, color: "rgba(255, 255, 255, 0.72)" }}>
                  {t.message}
                </div>
              </div>

              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Close toast"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: "1px solid rgba(255, 255, 255, 0.14)",
                  background: "rgba(255, 255, 255, 0.03)",
                  color: "rgba(255, 255, 255, 0.78)",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
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
