"use client";

import Link from "next/link";

type SetupItem = { id: string; label: string; detail: string; complete: boolean };
type TryItem = { id: string; label: string; detail: string };

type SetupStatus = {
  percent: number;
  completed: number;
  total: number;
  required: SetupItem[];
  thingsToTry: TryItem[];
};

export function SetupChecklistDrawer({ open, onClose, status }: { open: boolean; onClose: () => void; status?: SetupStatus | null }) {
  if (!open) return null;
  const percent = status?.percent ?? 0;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, pointerEvents: "auto" }}>
      <button type="button" aria-label="Close setup checklist" onClick={onClose} style={{ position: "absolute", inset: 0, border: 0, background: "rgba(2,6,23,.48)" }} />
      <aside style={{ position: "absolute", top: 0, right: 0, width: "min(100%, 430px)", height: "100%", overflowY: "auto", background: "var(--card, #0b1220)", color: "var(--foreground)", borderLeft: "1px solid var(--border)", boxShadow: "-28px 0 80px rgba(2,6,23,.35)", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Workspace setup</p>
            <h2 style={{ margin: "4px 0 8px", fontSize: 26 }}>Complete setup</h2>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.55 }}>Finish the operational basics before going live with customers.</p>
          </div>
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>

        <div style={{ marginTop: 22, padding: 18, borderRadius: 18, border: "1px solid var(--border)", background: "rgba(255,255,255,.035)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <strong>{percent}% complete</strong>
            <span style={{ color: "var(--muted)" }}>{status?.completed ?? 0}/{status?.total ?? 0}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(148,163,184,.18)", overflow: "hidden" }}>
            <div style={{ width: `${percent}%`, height: "100%", background: "linear-gradient(90deg, var(--gold), var(--accent-gold, #D4A84B))" }} />
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <h3 style={{ fontSize: 16, marginBottom: 12 }}>Required before live operations</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {(status?.required ?? []).map((item) => (
              <div key={item.id} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 12, padding: 14, borderRadius: 14, border: "1px solid var(--border)", background: item.complete ? "rgba(34,197,94,.08)" : "rgba(255,255,255,.025)" }}>
                <span style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", background: item.complete ? "rgba(34,197,94,.18)" : "rgba(148,163,184,.15)", color: item.complete ? "#22c55e" : "var(--muted)", fontSize: 13 }}>{item.complete ? "✓" : ""}</span>
                <span>
                  <strong style={{ display: "block" }}>{item.label}</strong>
                  <small style={{ color: "var(--muted)", lineHeight: 1.45 }}>{item.detail}</small>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <h3 style={{ fontSize: 16, marginBottom: 12 }}>Things to try</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {(status?.thingsToTry ?? []).map((item) => (
              <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "rgba(255,255,255,.025)" }}>
                <strong style={{ display: "block", marginBottom: 8 }}>{item.label}</strong>
                <small style={{ color: "var(--muted)", lineHeight: 1.45 }}>{item.detail}</small>
              </div>
            ))}
          </div>
        </div>

        <Link href="/onboarding" className="btn btn-primary" style={{ width: "100%", marginTop: 24, justifyContent: "center" }} onClick={onClose}>Open guided setup</Link>
      </aside>
    </div>
  );
}
