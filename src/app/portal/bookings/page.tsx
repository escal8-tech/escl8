"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { trpc } from "@/utils/trpc";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import { generateSlots } from "./components/slotUtils";
import type { Booking, Slot } from "./components/types";

/* ─────────────────────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────────────────────── */
const Icons = {
  chevronLeft: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  chevronRight: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  calendar: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  clock: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  user: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  phone: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  x: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  note: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  today: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  users: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

/* ─────────────────────────────────────────────────────────────────────────────
   STYLES
───────────────────────────────────────────────────────────────────────────── */
const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    width: "100%",
    padding: "0 24px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: "#f1f5f9",
    letterSpacing: "-0.025em",
    background: "linear-gradient(135deg, #f1f5f9 0%, #D4A84B 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 15,
  },
  headerControls: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  navBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 42,
    height: 42,
    borderRadius: 12,
    border: "1px solid rgba(184, 134, 11, 0.3)",
    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(26, 31, 46, 0.8) 100%)",
    color: "#f1f5f9",
    cursor: "pointer",
    transition: "all 0.2s ease",
    flexShrink: 0,
  },
  weekDisplay: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 18px",
    borderRadius: 12,
    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(26, 31, 46, 0.8) 100%)",
    border: "1px solid rgba(184, 134, 11, 0.3)",
    fontSize: 14,
    fontWeight: 500,
    color: "#f1f5f9",
    whiteSpace: "nowrap" as const,
    minWidth: "fit-content",
  },
  todayBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 18px",
    borderRadius: 12,
    border: "1px solid rgba(184, 134, 11, 0.5)",
    background: "linear-gradient(135deg, #B8860B 0%, #8B6914 100%)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: "0 0 20px rgba(184, 134, 11, 0.3)",
    flexShrink: 0,
  },
  dateInput: {
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid rgba(184, 134, 11, 0.3)",
    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(26, 31, 46, 0.8) 100%)",
    fontSize: 14,
    color: "#f1f5f9",
    cursor: "pointer",
    outline: "none",
    minWidth: 140,
    colorScheme: "dark",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
  },
  statCard: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: 22,
    borderRadius: 16,
    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(26, 31, 46, 0.8) 100%)",
    border: "1px solid rgba(184, 134, 11, 0.25)",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.2)",
    backdropFilter: "blur(10px)",
    transition: "all 0.2s ease",
  },
  statIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 52,
    height: 52,
    borderRadius: 14,
    flexShrink: 0,
  },
  statInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  statValue: {
    fontSize: 26,
    fontWeight: 700,
    color: "#f1f5f9",
    letterSpacing: "-0.02em",
  },
  statLabel: {
    fontSize: 13,
    color: "#94a3b8",
  },
  calendarContainer: {
    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(26, 31, 46, 0.9) 100%)",
    borderRadius: 20,
    border: "1px solid rgba(184, 134, 11, 0.3)",
    overflow: "hidden",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
  },
  calendarHeader: {
    display: "grid",
    gridTemplateColumns: "80px repeat(7, 1fr)",
    borderBottom: "1px solid rgba(184, 134, 11, 0.2)",
    background: "linear-gradient(90deg, rgba(184, 134, 11, 0.1) 0%, rgba(0, 51, 160, 0.1) 100%)",
  },
  calendarHeaderCell: {
    padding: "16px 10px",
    textAlign: "center" as const,
    borderRight: "1px solid rgba(184, 134, 11, 0.15)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
  },
  dayName: {
    fontSize: 12,
    fontWeight: 600,
    color: "#94a3b8",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: 700,
    color: "#f1f5f9",
    width: 38,
    height: 38,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  todayCircle: {
    background: "linear-gradient(135deg, #B8860B 0%, #D4A84B 100%)",
    color: "#fff",
    boxShadow: "0 0 16px rgba(184, 134, 11, 0.5)",
  },
  timeCell: {
    padding: "10px 12px",
    borderRight: "1px solid rgba(184, 134, 11, 0.15)",
    borderBottom: "1px solid rgba(184, 134, 11, 0.15)",
    fontSize: 13,
    fontWeight: 500,
    color: "#94a3b8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.6)",
  },
  calendarBody: {
    maxHeight: "calc(100vh - 380px)",
    overflow: "auto",
  },
  calendarRow: {
    display: "grid",
    gridTemplateColumns: "80px repeat(7, 1fr)",
  },
  slotCell: {
    borderRight: "1px solid rgba(184, 134, 11, 0.15)",
    borderBottom: "1px solid rgba(184, 134, 11, 0.15)",
    minHeight: 64,
    cursor: "pointer",
    transition: "all 0.15s ease",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: 10,
    position: "relative" as const,
    background: "rgba(15, 23, 42, 0.4)",
  },
  slotCount: {
    fontSize: 17,
    fontWeight: 700,
  },
  slotCapacity: {
    fontSize: 11,
    fontWeight: 500,
    opacity: 0.7,
  },
  slotBadge: {
    position: "absolute" as const,
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: "50%",
  },
  // Modal Styles
  modalBackdrop: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0, 0, 0, 0.7)",
    backdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    animation: "fadeIn 0.2s ease",
  },
  modal: {
    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(26, 31, 46, 0.95) 100%)",
    borderRadius: 24,
    boxShadow: "0 25px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(184, 134, 11, 0.15)",
    border: "1px solid rgba(184, 134, 11, 0.3)",
    width: "min(600px, 95vw)",
    maxHeight: "85vh",
    overflow: "hidden",
    animation: "scaleIn 0.25s ease",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "22px 26px",
    borderBottom: "1px solid rgba(184, 134, 11, 0.2)",
    background: "linear-gradient(90deg, rgba(184, 134, 11, 0.1) 0%, rgba(0, 51, 160, 0.08) 100%)",
  },
  modalTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
    color: "#f1f5f9",
  },
  modalSubtitle: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 4,
  },
  modalClose: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: 12,
    border: "1px solid rgba(184, 134, 11, 0.3)",
    background: "rgba(15, 23, 42, 0.8)",
    color: "#94a3b8",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  modalBody: {
    padding: 26,
    maxHeight: "calc(85vh - 150px)",
    overflow: "auto",
  },
  bookingsList: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  bookingCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    padding: 18,
    borderRadius: 14,
    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.8) 0%, rgba(26, 31, 46, 0.7) 100%)",
    border: "1px solid rgba(184, 134, 11, 0.2)",
    transition: "all 0.2s ease",
  },
  bookingAvatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 14,
    background: "linear-gradient(135deg, #B8860B 0%, #D4A84B 100%)",
    color: "#fff",
    fontWeight: 700,
    fontSize: 16,
    flexShrink: 0,
    boxShadow: "0 0 20px rgba(184, 134, 11, 0.3)",
  },
  bookingInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  bookingRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 14,
    color: "#f1f5f9",
  },
  bookingLabel: {
    color: "#94a3b8",
    minWidth: 80,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
    textAlign: "center" as const,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    background: "linear-gradient(135deg, rgba(184, 134, 11, 0.15) 0%, rgba(0, 51, 160, 0.1) 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#D4A84B",
    marginBottom: 20,
    border: "1px solid rgba(184, 134, 11, 0.2)",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: "#f1f5f9",
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 14,
    color: "#94a3b8",
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    padding: "14px 22px",
    background: "linear-gradient(90deg, rgba(184, 134, 11, 0.08) 0%, rgba(0, 51, 160, 0.05) 100%)",
    borderTop: "1px solid rgba(184, 134, 11, 0.2)",
    fontSize: 13,
    color: "#94a3b8",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 4,
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   SLOT CELL COMPONENT
───────────────────────────────────────────────────────────────────────────── */
function SlotCellComponent({
  slot,
  bookings,
  onClick,
}: {
  slot: Slot;
  bookings: Booking[];
  onClick: () => void;
}) {
  const utilization = slot.capacity > 0 ? slot.count / slot.capacity : 0;
  
  let bgColor = "rgba(15, 23, 42, 0.4)";
  let textColor = "#64748b";
  let badgeColor = "transparent";
  
  if (slot.capacity > 0) {
    if (utilization === 0) {
      bgColor = "rgba(16, 185, 129, 0.15)";
      textColor = "#10b981";
    } else if (utilization < 1) {
      bgColor = "rgba(184, 134, 11, 0.15)";
      textColor = "#D4A84B";
      badgeColor = "#D4A84B";
    } else {
      bgColor = "rgba(239, 68, 68, 0.15)";
      textColor = "#ef4444";
      badgeColor = "#ef4444";
    }
  }
  
  return (
    <div
      style={{
        ...styles.slotCell,
        background: bgColor,
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "scale(1.02)";
        e.currentTarget.style.zIndex = "10";
        e.currentTarget.style.boxShadow = "0 0 20px rgba(184, 134, 11, 0.2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
        e.currentTarget.style.zIndex = "1";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <span style={{ ...styles.slotCount, color: textColor }}>
        {slot.count}
      </span>
      {slot.capacity > 0 && (
        <span style={{ ...styles.slotCapacity, color: textColor }}>
          / {slot.capacity}
        </span>
      )}
      {bookings.length > 0 && (
        <div style={{ ...styles.slotBadge, background: badgeColor }} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   BOOKING MODAL COMPONENT
───────────────────────────────────────────────────────────────────────────── */
function BookingModal({
  slot,
  bookings,
  timeslotMinutes,
  onClose,
}: {
  slot: Slot;
  bookings: Booking[];
  timeslotMinutes: number;
  onClose: () => void;
}) {
  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });

  const formatDate = (date: Date) =>
    date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  const getInitials = (phone: string | null | undefined) => {
    if (!phone) return "?";
    return phone.slice(-2);
  };

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div>
            <h3 style={styles.modalTitle}>
              {formatTime(slot.start)} Bookings
            </h3>
            <p style={styles.modalSubtitle}>
              {formatDate(slot.start)} • {slot.count}/{slot.capacity} slots filled
            </p>
          </div>
          <button style={styles.modalClose} onClick={onClose}>
            {Icons.x}
          </button>
        </div>
        <div style={styles.modalBody}>
          {bookings.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>{Icons.calendar}</div>
              <p style={styles.emptyTitle}>No bookings</p>
              <p style={styles.emptyDesc}>This time slot has no bookings yet</p>
            </div>
          ) : (
            <div style={styles.bookingsList}>
              {bookings.map((b, idx) => (
                <div key={b.id} style={styles.bookingCard}>
                  <div style={styles.bookingAvatar}>
                    {getInitials(b.phoneNumber)}
                  </div>
                  <div style={styles.bookingInfo}>
                    <div style={styles.bookingRow}>
                      <span style={styles.bookingLabel}>{Icons.clock}</span>
                      <span>
                        {new Date(b.startTime).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        • {b.durationMinutes || timeslotMinutes} min
                      </span>
                    </div>
                    <div style={styles.bookingRow}>
                      <span style={styles.bookingLabel}>{Icons.users}</span>
                      <span>{b.unitsBooked || 1} unit(s) booked</span>
                    </div>
                    {b.phoneNumber && (
                      <div style={styles.bookingRow}>
                        <span style={styles.bookingLabel}>{Icons.phone}</span>
                        <span>{b.phoneNumber}</span>
                      </div>
                    )}
                    {b.notes && (
                      <div style={styles.bookingRow}>
                        <span style={styles.bookingLabel}>{Icons.note}</span>
                        <span style={{ color: "var(--muted)" }}>{b.notes}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN BOOKINGS PAGE
───────────────────────────────────────────────────────────────────────────── */
export default function BookingsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [email, setEmail] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const biz = trpc.business.getMine.useQuery(
    { email: email || "" },
    { enabled: !!email }
  );
  const bookings = trpc.bookings.list.useQuery(
    { businessId: biz.data?.id ?? "" },
    { enabled: !!biz.data?.id }
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const auth = getFirebaseAuth();
      const unsub = onAuthStateChanged(auth, (u) => {
        const em = u?.email || window.localStorage.getItem("lastEmail") || null;
        if (em) {
          setEmail(em);
          try {
            window.localStorage.setItem("lastEmail", em);
          } catch {}
        }
      });
      return () => unsub();
    } catch {
      const em = window.localStorage.getItem("lastEmail");
      if (em) setEmail(em);
    }
  }, []);

  const normalizeBookings = useCallback((bookings: any[]): Booking[] => {
    return bookings.map((b) => ({
      ...b,
      startTime:
        b.startTime instanceof Date ? b.startTime.toISOString() : b.startTime,
    }));
  }, []);

  const normalizedBookings = useMemo(
    () => normalizeBookings(bookings.data || []),
    [bookings.data, normalizeBookings]
  );

  const slots = useMemo(() => {
    return generateSlots(
      selectedDate,
      {
        open: biz.data?.bookingOpenTime ?? "09:00",
        close: biz.data?.bookingCloseTime ?? "18:00",
        minutes: biz.data?.bookingTimeslotMinutes ?? 60,
        capacity: biz.data?.bookingUnitCapacity,
      },
      normalizedBookings
    );
  }, [normalizedBookings, biz.data, selectedDate]);

  // Group slots by time label
  const slotsByLabel = useMemo(() => {
    const m = new Map<string, Slot[]>();
    const fmt = (d: Date) =>
      d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
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

  // Get week days for header
  const weekDays = useMemo(() => {
    if (slots.length === 0) return [];
    const first = slots[0].start;
    const monday = new Date(first);
    const dayIdx = monday.getDay();
    const diffToMonday = dayIdx === 0 ? -6 : 1 - dayIdx;
    monday.setDate(monday.getDate() + diffToMonday);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, [slots]);

  // Stats
  const stats = useMemo(() => {
    const total = normalizedBookings.length;
    const today = new Date().toISOString().slice(0, 10);
    const todayBookings = normalizedBookings.filter(
      (b) => new Date(b.startTime).toISOString().slice(0, 10) === today
    ).length;
    const totalUnits = normalizedBookings.reduce(
      (sum, b) => sum + (b.unitsBooked || 1),
      0
    );
    const avgUtilization =
      slots.length > 0 && biz.data?.bookingUnitCapacity
        ? Math.round(
            (slots.reduce((sum, s) => sum + s.count, 0) /
              (slots.length * (biz.data.bookingUnitCapacity || 1))) *
              100
          )
        : 0;
    return { total, todayBookings, totalUnits, avgUtilization };
  }, [normalizedBookings, slots, biz.data?.bookingUnitCapacity]);

  const goPrevWeek = () =>
    setSelectedDate(
      new Date(new Date(selectedDate).getTime() - 7 * 86400000)
        .toISOString()
        .slice(0, 10)
    );
  const goNextWeek = () =>
    setSelectedDate(
      new Date(new Date(selectedDate).getTime() + 7 * 86400000)
        .toISOString()
        .slice(0, 10)
    );
  const goToday = () => setSelectedDate(new Date().toISOString().slice(0, 10));

  const timeslotMinutes = biz.data?.bookingTimeslotMinutes ?? 60;
  const bookingUnitCapacity = biz.data?.bookingUnitCapacity ?? 0;

  const getBookingsForSlot = useCallback(
    (slot: Slot) => {
      return normalizedBookings.filter((b) => {
        const bs = new Date(b.startTime);
        const be = new Date(
          bs.getTime() + (b.durationMinutes || timeslotMinutes) * 60000
        );
        return (
          bs.getTime() < slot.end.getTime() && be.getTime() > slot.start.getTime()
        );
      });
    },
    [normalizedBookings, timeslotMinutes]
  );

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const formatWeekRange = () => {
    if (weekDays.length === 0) return "";
    const first = weekDays[0];
    const last = weekDays[6];
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${first.toLocaleDateString(undefined, opts)} - ${last.toLocaleDateString(undefined, opts)}, ${last.getFullYear()}`;
  };

  return (
    <div style={styles.page}>
      {/* Date Controls */}
      <div style={styles.headerControls}>
        <button style={styles.navBtn} onClick={goPrevWeek}>
          {Icons.chevronLeft}
        </button>
        <div style={styles.weekDisplay}>
          <span style={{ color: "var(--accent)" }}>{Icons.calendar}</span>
          {formatWeekRange()}
        </div>
        <button style={styles.navBtn} onClick={goNextWeek}>
          {Icons.chevronRight}
        </button>
        <input
          type="date"
          style={styles.dateInput}
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
        <button style={styles.todayBtn} onClick={goToday}>
          {Icons.today}
          Today
        </button>
      </div>

      {/* Stats */}
      <div style={styles.stats}>
        <div style={styles.statCard}>
          <div
            style={{
              ...styles.statIcon,
              background: "rgba(0, 51, 160, 0.1)",
              color: "var(--primary)",
            }}
          >
            {Icons.calendar}
          </div>
          <div style={styles.statInfo}>
            <span style={styles.statValue}>{stats.total}</span>
            <span style={styles.statLabel}>Total Bookings</span>
          </div>
        </div>
        <div style={styles.statCard}>
          <div
            style={{
              ...styles.statIcon,
              background: "rgba(0, 212, 255, 0.1)",
              color: "var(--accent)",
            }}
          >
            {Icons.today}
          </div>
          <div style={styles.statInfo}>
            <span style={styles.statValue}>{stats.todayBookings}</span>
            <span style={styles.statLabel}>Today&apos;s Bookings</span>
          </div>
        </div>
        <div style={styles.statCard}>
          <div
            style={{
              ...styles.statIcon,
              background: "rgba(16, 185, 129, 0.1)",
              color: "var(--success)",
            }}
          >
            {Icons.users}
          </div>
          <div style={styles.statInfo}>
            <span style={styles.statValue}>{stats.totalUnits}</span>
            <span style={styles.statLabel}>Units Booked</span>
          </div>
        </div>
        <div style={styles.statCard}>
          <div
            style={{
              ...styles.statIcon,
              background: "rgba(139, 92, 246, 0.1)",
              color: "#8b5cf6",
            }}
          >
            {Icons.clock}
          </div>
          <div style={styles.statInfo}>
            <span style={styles.statValue}>{stats.avgUtilization}%</span>
            <span style={styles.statLabel}>Avg Utilization</span>
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div style={styles.calendarContainer}>
        {/* Calendar Header */}
        <div style={styles.calendarHeader}>
          <div
            style={{
              ...styles.calendarHeaderCell,
              background: "var(--card-muted)",
              justifyContent: "center",
            }}
          >
            <span style={styles.dayName}>Time</span>
          </div>
          {weekDays.map((day, i) => (
            <div key={i} style={styles.calendarHeaderCell}>
              <span style={styles.dayName}>
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span
                style={{
                  ...styles.dayNumber,
                  ...(isToday(day) ? styles.todayCircle : {}),
                }}
              >
                {day.getDate()}
              </span>
            </div>
          ))}
        </div>

        {/* Calendar Body */}
        <div style={styles.calendarBody}>
          {rowLabels.map((label, idxRow) => {
            const row = slotsByLabel.get(label) || [];
            return (
              <div key={`row-${idxRow}`} style={styles.calendarRow}>
                <div style={styles.timeCell}>{label}</div>
                {row.map((slot, idxCol) => {
                  const slotBookings = getBookingsForSlot(slot);
                  return (
                    <SlotCellComponent
                      key={`slot-${idxRow}-${idxCol}`}
                      slot={slot}
                      bookings={slotBookings}
                      onClick={() => setSelectedSlot(slot)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={styles.legend}>
          <div style={styles.legendItem}>
            <div
              style={{
                ...styles.legendDot,
                background: "rgba(16, 185, 129, 0.3)",
              }}
            />
            <span>Available</span>
          </div>
          <div style={styles.legendItem}>
            <div
              style={{
                ...styles.legendDot,
                background: "rgba(0, 212, 255, 0.3)",
              }}
            />
            <span>Partially Booked</span>
          </div>
          <div style={styles.legendItem}>
            <div
              style={{ ...styles.legendDot, background: "rgba(239, 68, 68, 0.3)" }}
            />
            <span>Fully Booked</span>
          </div>
        </div>
      </div>

      {/* Booking Modal */}
      {selectedSlot && (
        <BookingModal
          slot={selectedSlot}
          bookings={getBookingsForSlot(selectedSlot)}
          timeslotMinutes={timeslotMinutes}
          onClose={() => setSelectedSlot(null)}
        />
      )}
    </div>
  );
}
