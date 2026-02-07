"use client";

import { useMemo } from "react";
import { SlotCell } from "./SlotCell";
import type { Booking, Slot } from "./types";

type Props = {
  slots: Slot[];
  bookings: Booking[];
  bookingUnitCapacity: number;
  bookingTimeslotMinutes: number;
};

export function SlotsGrid({ slots, bookings, bookingUnitCapacity, bookingTimeslotMinutes }: Props) {
  const slotsByLabel = useMemo(() => {
    const m = new Map<string, Slot[]>();
    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    for (const s of slots) {
      const label = fmt(s.start);
      const arr = m.get(label) || [];
      arr.push(s);
      m.set(label, arr);
    }
    return m;
  }, [slots]);

  const rowLabels = useMemo(() => {
    const labels = Array.from(slotsByLabel.keys());
    const toMinutes = (label: string) => {
      const [h, m] = label.split(":").map(Number);
      return h * 60 + m;
    };
    return labels.sort((a, b) => toMinutes(a) - toMinutes(b));
  }, [slotsByLabel]);

  return (
    <div className="glass" style={{ padding: 0, height: "calc(100vh - 180px)", overflow: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "80px repeat(7, 1fr)", borderTop: "1px solid var(--border)" }}>
        {/* Header row: days */}
        <div style={{ padding: 8, borderRight: "1px solid var(--border)", background: "rgba(0,0,0,0.04)" }}>Time</div>
        {Array.from({ length: 7 }).map((_, i) => {
          const day = new Date(slots[0]?.start || new Date());
          if (slots.length) {
            const first = slots[0].start;
            const monday = new Date(first);
            const dayIdx = monday.getDay();
            const diffToMonday = dayIdx === 0 ? -6 : 1 - dayIdx;
            monday.setDate(monday.getDate() + diffToMonday);
            day.setDate(monday.getDate() + i);
          }
          return (
            <div
              key={i}
              style={{ padding: 8, borderRight: "1px solid var(--border)", background: "rgba(0,0,0,0.04)" }}
            >
              {day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </div>
          );
        })}
        {/* Body: slots per day */}
        {rowLabels.map((label, idxRow) => {
          const row = slotsByLabel.get(label) || [];
          const rowHeight = `calc((100vh - 180px) / ${rowLabels.length || 1})`;
          return (
            <>
              <div
                key={`t-${idxRow}`}
                style={{
                  padding: 6,
                  borderTop: "1px solid var(--border)",
                  borderRight: "1px solid var(--border)",
                  height: rowHeight,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {label}
              </div>
              {row.map((s, idxCol) => {
                const hasCap = (bookingUnitCapacity ?? 0) > 0;
                const full = hasCap ? s.count >= bookingUnitCapacity : false;
                const bg = hasCap ? (full ? "rgba(255,60,60,0.25)" : "rgba(60,200,120,0.25)") : "rgba(0,0,0,0.06)";
                return (
                  <SlotCell
                    key={`c-${idxRow}-${idxCol}`}
                    slot={{ ...s, capacity: bookingUnitCapacity ?? 0 }}
                    height={rowHeight}
                    bg={bg}
                    bookings={bookings.filter((b) => {
                      const bs = new Date(b.startTime);
                      const be = new Date(bs.getTime() + (b.durationMinutes || bookingTimeslotMinutes) * 60000);
                      return bs.getTime() < s.end.getTime() && be.getTime() > s.start.getTime();
                    })}
                  />
                );
              })}
            </>
          );
        })}
      </div>
    </div>
  );
}
