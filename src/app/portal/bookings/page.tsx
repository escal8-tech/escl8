/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/preserve-manual-memoization,react-hooks/set-state-in-effect */
"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { trpc } from "@/utils/trpc";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDaysToDateKey,
  formatDateKey,
  formatTimeInTimeZone,
  generateSlots,
  getDateKeyInTimeZone,
  getTodayDateKeyInTimeZone,
  getWeekDateKeys,
} from "./components/slotUtils";
import type { Booking, Slot } from "./components/types";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";

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
    gap: 12,
    width: "100%",
    padding: 0,
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
    color: "var(--portal-text)",
    letterSpacing: "-0.025em",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 15,
  },
  headerControls: {
    display: "flex",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    padding: 12,
    borderRadius: 14,
    border: "1px solid var(--portal-border)",
    background: "var(--portal-card-plain)",
  },
  headerControlsPrimary: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: "0 1 auto",
    minWidth: 0,
  },
  headerControlsSecondary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    flex: "0 1 auto",
    minWidth: 0,
    flexWrap: "wrap",
    marginLeft: "auto",
  },
  weekNavGroup: {
    display: "flex",
    alignItems: "stretch",
    gap: 10,
    minWidth: 0,
    flex: "0 1 auto",
  },
  navBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderRadius: 12,
    border: "1px solid var(--portal-border)",
    background: "var(--portal-card-plain)",
    color: "var(--portal-text)",
    cursor: "pointer",
    transition: "all 0.2s ease",
    flexShrink: 0,
  },
  weekDisplay: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0 16px",
    minHeight: 44,
    borderRadius: 12,
    background: "rgba(255, 255, 255, 0.02)",
    border: "1px solid var(--portal-border)",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--portal-text)",
    whiteSpace: "nowrap" as const,
    minWidth: 0,
    flex: "0 1 auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  todayBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    padding: "0 16px",
    borderRadius: 12,
    border: "1px solid transparent",
    background: "#b59a5a",
    color: "#162033",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    flexShrink: 0,
  },
  dateControl: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid var(--portal-border)",
    background: "rgba(255, 255, 255, 0.02)",
    minWidth: 0,
  },
  dateControlLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--portal-text-muted)",
    whiteSpace: "nowrap" as const,
  },
  dateInput: {
    height: 42,
    padding: "0 0 0 2px",
    borderRadius: 10,
    border: "none",
    background: "transparent",
    fontSize: 14,
    color: "var(--portal-text)",
    cursor: "pointer",
    outline: "none",
    minWidth: 132,
    colorScheme: "dark",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  statCard: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: 18,
    borderRadius: 14,
    background: "var(--portal-card-plain)",
    border: "1px solid var(--portal-border)",
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
    fontSize: 24,
    fontWeight: 700,
    color: "var(--portal-text)",
    letterSpacing: "-0.02em",
  },
  statLabel: {
    fontSize: 12,
    color: "var(--portal-text-muted)",
  },
  calendarContainer: {
    background: "var(--portal-card-plain)",
    borderRadius: 14,
    border: "1px solid var(--portal-border)",
    overflow: "hidden",
    boxShadow: "none",
  },
  calendarHeader: {
    display: "grid",
    gridTemplateColumns: "80px repeat(7, 1fr)",
    borderBottom: "1px solid var(--portal-border-soft)",
    background: "var(--portal-card-plain)",
  },
  calendarHeaderCell: {
    padding: "16px 10px",
    textAlign: "center" as const,
    borderRight: "1px solid var(--portal-border-soft)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
  },
  dayName: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--portal-text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--portal-text)",
    width: 38,
    height: 38,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  todayCircle: {
    background: "#b59a5a",
    color: "#162033",
  },
  timeCell: {
    padding: "10px 12px",
    borderRight: "1px solid var(--portal-border-soft)",
    borderBottom: "1px solid var(--portal-border-soft)",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--portal-text-muted)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--portal-surface)",
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
    borderRight: "1px solid var(--portal-border-soft)",
    borderBottom: "1px solid var(--portal-border-soft)",
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
    background: "var(--portal-surface)",
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
    background: "rgba(0, 0, 0, 0.45)",
    backdropFilter: "blur(1px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    animation: "fadeIn 0.2s ease",
  },
  modal: {
    background: "var(--portal-card-plain)",
    borderRadius: 18,
    boxShadow: "0 18px 42px rgba(2, 8, 20, 0.26)",
    border: "1px solid var(--portal-border)",
    width: "min(600px, 95vw)",
    maxHeight: "85vh",
    overflow: "hidden",
    animation: "scaleIn 0.25s ease",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 20px",
    borderBottom: "1px solid var(--portal-border)",
    background: "var(--portal-card-plain)",
  },
  modalTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    color: "var(--portal-text)",
  },
  modalSubtitle: {
    fontSize: 13,
    color: "var(--portal-text-muted)",
    marginTop: 4,
  },
  modalClose: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: 12,
    border: "1px solid var(--portal-border)",
    background: "var(--portal-card-plain)",
    color: "var(--portal-text-muted)",
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
    padding: 16,
    borderRadius: 16,
    background: "var(--portal-surface)",
    border: "1px solid var(--portal-border)",
    transition: "all 0.2s ease",
  },
  bookingAvatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 14,
    background: "#b59a5a",
    color: "#162033",
    fontWeight: 700,
    fontSize: 16,
    flexShrink: 0,
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
    color: "var(--portal-text)",
  },
  bookingLabel: {
    color: "var(--portal-text-muted)",
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
    background: "var(--portal-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#b59a5a",
    marginBottom: 20,
    border: "1px solid var(--portal-border)",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: "var(--portal-text)",
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 14,
    color: "var(--portal-text-muted)",
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    padding: "14px 18px",
    background: "var(--portal-card-plain)",
    borderTop: "1px solid var(--portal-border)",
    fontSize: 13,
    color: "var(--portal-text-muted)",
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
  let textColor = "var(--portal-text-soft)";
  let badgeColor = "transparent";
  
  if (slot.capacity > 0) {
    if (utilization === 0) {
      bgColor = "rgba(16, 185, 129, 0.05)";
      textColor = "#34d399";
    } else if (utilization < 1) {
      bgColor = "rgba(181, 154, 90, 0.12)";
      textColor = "#b59a5a";
      badgeColor = "#b59a5a";
    } else {
      bgColor = "rgba(239, 68, 68, 0.06)";
      textColor = "#f87171";
      badgeColor = "#f87171";
    }
  } else {
    bgColor = "var(--portal-surface)";
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
        e.currentTarget.style.boxShadow = "0 8px 18px rgba(2, 8, 20, 0.18)";
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
  timeZone,
  onClose,
}: {
  slot: Slot;
  bookings: Booking[];
  timeslotMinutes: number;
  timeZone: string;
  onClose: () => void;
}) {
  const formatTime = (date: Date) =>
    formatTimeInTimeZone(date, timeZone, true);

  const formatDate = (date: Date) =>
    formatDateKey(getDateKeyInTimeZone(date, timeZone), {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

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
              {bookings.map((b) => (
                <div key={b.id} style={styles.bookingCard}>
                  <div style={styles.bookingAvatar}>
                    {getInitials(b.phoneNumber)}
                  </div>
                  <div style={styles.bookingInfo}>
                    <div style={styles.bookingRow}>
                      <span style={styles.bookingLabel}>{Icons.clock}</span>
                      <span>
                        {new Date(b.startTime).toLocaleTimeString([], {
                          timeZone,
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
    getTodayDateKeyInTimeZone("UTC")
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
  const bookingsLiveInput = useMemo(
    () => (biz.data?.id ? { businessId: biz.data.id } : undefined),
    [biz.data?.id],
  );
  useLivePortalEvents({ bookingsListInput: bookingsLiveInput });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const auth = getFirebaseAuth();
    if (!auth) {
      const em = window.localStorage.getItem("lastEmail");
      if (em) setEmail(em);
      return;
    }

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

  const businessTimezone = useMemo(() => {
    const tz = (biz.data?.settings as Record<string, unknown> | null | undefined)?.timezone;
    return typeof tz === "string" && tz.trim() ? tz.trim() : "UTC";
  }, [biz.data?.settings]);

  const bookingHoursConfigured = useMemo(() => {
    const open = biz.data?.bookingOpenTime;
    const close = biz.data?.bookingCloseTime;
    return Boolean(typeof open === "string" && open.trim() && typeof close === "string" && close.trim());
  }, [biz.data?.bookingOpenTime, biz.data?.bookingCloseTime]);

  const slots = useMemo(() => {
    return generateSlots(
      selectedDate,
      {
        open: biz.data?.bookingOpenTime ?? undefined,
        close: biz.data?.bookingCloseTime ?? undefined,
        minutes: biz.data?.bookingTimeslotMinutes ?? 60,
        capacity: biz.data?.bookingUnitCapacity,
      },
      normalizedBookings,
      businessTimezone,
    );
  }, [normalizedBookings, biz.data, selectedDate, businessTimezone]);

  // Group slots by time label
  const slotsByLabel = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) {
      const label = s.label;
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
    return getWeekDateKeys(selectedDate);
  }, [selectedDate]);

  // Stats
  const stats = useMemo(() => {
    const total = normalizedBookings.length;
    const today = getTodayDateKeyInTimeZone(businessTimezone);
    const todayBookings = normalizedBookings.filter(
      (b) => getDateKeyInTimeZone(b.startTime, businessTimezone) === today
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
  }, [normalizedBookings, slots, biz.data?.bookingUnitCapacity, businessTimezone]);

  const goPrevWeek = () =>
    setSelectedDate(addDaysToDateKey(selectedDate, -7));
  const goNextWeek = () =>
    setSelectedDate(addDaysToDateKey(selectedDate, 7));
  const goToday = () => setSelectedDate(getTodayDateKeyInTimeZone(businessTimezone));

  const timeslotMinutes = biz.data?.bookingTimeslotMinutes ?? 60;

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

  const isToday = (dateKey: string) => dateKey === getTodayDateKeyInTimeZone(businessTimezone);

  const formatWeekRange = () => {
    if (weekDays.length === 0) return "";
    const first = weekDays[0];
    const last = weekDays[6];
    return `${formatDateKey(first, { month: "short", day: "numeric" })} - ${formatDateKey(last, { month: "short", day: "numeric" })}, ${last.slice(0, 4)}`;
  };

  return (
    <div style={styles.page}>
      {/* Date Controls */}
      <div style={styles.headerControls}>
        <div style={styles.headerControlsPrimary}>
          <div style={styles.weekNavGroup}>
            <button style={styles.navBtn} onClick={goPrevWeek} aria-label="Previous week">
              {Icons.chevronLeft}
            </button>
            <div style={styles.weekDisplay}>
              <span style={{ color: "var(--portal-primary)", display: "flex" }}>{Icons.calendar}</span>
              {formatWeekRange()}
            </div>
            <button style={styles.navBtn} onClick={goNextWeek} aria-label="Next week">
              {Icons.chevronRight}
            </button>
          </div>
        </div>
        <div style={styles.headerControlsSecondary}>
          <div style={styles.dateControl}>
            <span style={styles.dateControlLabel}>Jump to</span>
            <input
              type="date"
              style={styles.dateInput}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              aria-label="Select booking date"
            />
          </div>
          <button style={styles.todayBtn} onClick={goToday}>
            {Icons.today}
            Today
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={styles.stats}>
        <div style={styles.statCard}>
          <div
            style={{
              ...styles.statIcon,
              background: "rgba(8, 55, 116, 0.12)",
              color: "var(--portal-primary)",
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
              background: "rgba(8, 55, 116, 0.12)",
              color: "var(--portal-primary)",
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
              background: "rgba(181, 154, 90, 0.12)",
              color: "#b59a5a",
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

      {!bookingHoursConfigured && (
        <div
          style={{
            marginBottom: 16,
            borderRadius: 16,
            border: "1px solid rgba(180, 83, 9, 0.2)",
            background: "rgba(245, 158, 11, 0.12)",
            color: "#92400e",
            padding: "14px 16px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Booking hours are not configured for this business. Set opening and closing times in Settings before relying on this calendar.
        </div>
      )}

      {/* Calendar */}
      <div style={styles.calendarContainer}>
        {/* Calendar Header */}
        <div style={styles.calendarHeader}>
          <div
            style={{
              ...styles.calendarHeaderCell,
              background: "var(--portal-card-plain)",
              justifyContent: "center",
            }}
          >
            <span style={styles.dayName}>Time</span>
          </div>
          {weekDays.map((day) => (
            <div key={day} style={styles.calendarHeaderCell}>
              <span style={styles.dayName}>
                {formatDateKey(day, { weekday: "short" })}
              </span>
              <span
                style={{
                  ...styles.dayNumber,
                  ...(isToday(day) ? styles.todayCircle : {}),
                }}
              >
                {String(Number(day.slice(-2)))}
              </span>
            </div>
          ))}
        </div>

        {/* Calendar Body */}
        <div style={styles.calendarBody}>
          {!bookingHoursConfigured ? (
            <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
              No booking slots are shown because opening and closing times are not configured.
            </div>
          ) : rowLabels.map((label, idxRow) => {
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
                background: "rgba(16, 185, 129, 0.24)",
              }}
            />
            <span>Available</span>
          </div>
          <div style={styles.legendItem}>
            <div
              style={{
                ...styles.legendDot,
                background: "rgba(181, 154, 90, 0.24)",
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
          timeZone={businessTimezone}
          onClose={() => setSelectedSlot(null)}
        />
      )}
    </div>
  );
}
