"use client";

import { useState } from "react";
import type { Booking, Slot } from "./types";

type Props = {
  slot: Slot;
  height: string;
  bg: string;
  bookings: Booking[];
};

export function SlotCell({ slot, height, bg, bookings }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        background: bg,
        height,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
      }}
      onClick={() => setOpen(true)}
    >
      <span style={{ fontWeight: 700 }}>{slot.count}/{slot.capacity}</span>
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "grid",
            placeItems: "center",
            zIndex: 1000,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="glass"
            style={{ width: "min(800px, 90vw)", maxHeight: "80vh", overflow: "auto", padding: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3>Bookings for {slot.start.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" })}</h3>
              <button className="btn" onClick={() => setOpen(false)}>Close</button>
            </div>
            {bookings.length === 0 ? (
              <p className="muted" style={{ marginTop: 8 }}>No bookings in this slot.</p>
            ) : (
              <table style={{ width: "100%", marginTop: 10, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>Start</th>
                    <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>Units</th>
                    <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>Phone</th>
                    <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id}>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>{new Date(b.startTime).toLocaleString()}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>{b.unitsBooked}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>{b.phoneNumber || "—"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>{b.notes || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}