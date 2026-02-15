"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { trpc } from "@/utils/trpc";
import { PortalSelect } from "@/app/portal/components/PortalSelect";

/* ─────────────────────────────────────────────────────────────────────────────
   ICONS (inline SVGs for clean dependency-free icons)
───────────────────────────────────────────────────────────────────────────── */
const Icons = {
  user: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  calendar: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  whatsapp: (
    <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  ),
  bell: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  shield: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  bot: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  ),
  clock: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  check: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  logout: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  save: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1-2 2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  users: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  building: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  ),
  toggle: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
      <circle cx="8" cy="12" r="3" />
    </svg>
  ),
  ticket: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V9z" />
      <path d="M9 9v12" />
    </svg>
  ),
};

/* ─────────────────────────────────────────────────────────────────────────────
   STYLES (inline CSS in this file for the settings page)
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
    paddingTop: 8,
  },
  headerTitle: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: "var(--foreground)",
    letterSpacing: "-0.025em",
  },
  headerSubtitle: {
    marginTop: 6,
    color: "var(--muted)",
    fontSize: 15,
    lineHeight: 1.5,
  },
  tabs: {
    display: "flex",
    gap: 6,
    padding: "4px",
    background: "var(--card-muted)",
    borderRadius: 12,
    width: "fit-content",
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 18px",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease",
    background: "transparent",
    color: "var(--muted)",
  },
  tabActive: {
    background: "var(--card)",
    color: "var(--foreground)",
    boxShadow: "var(--shadow-sm)",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  card: {
    background: "var(--card)",
    borderRadius: 16,
    border: "1px solid var(--border)",
    overflow: "hidden",
    boxShadow: "var(--shadow-sm)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "20px 24px",
    borderBottom: "1px solid var(--border)",
    background: "linear-gradient(to right, var(--card), var(--card-muted))",
  },
  cardIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
    color: "#fff",
  },
  cardIconSecondary: {
    background: "linear-gradient(135deg, var(--accent), var(--cyan-600))",
  },
  cardTitle: {
    margin: 0,
    fontSize: 17,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  cardDescription: {
    margin: "4px 0 0",
    fontSize: 13,
    color: "var(--muted)",
  },
  cardBody: {
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  profileInfo: {
    display: "flex",
    alignItems: "center",
    gap: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: "linear-gradient(135deg, var(--primary), var(--accent))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 26,
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
  },
  profileDetails: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  profileName: {
    fontSize: 18,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  profileEmail: {
    fontSize: 14,
    color: "var(--muted)",
  },
  profileBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 500,
    background: "rgba(0, 212, 255, 0.1)",
    color: "var(--accent)",
    marginTop: 6,
    width: "fit-content",
  },
  usageCard: {
    gridColumn: "1 / -1",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--background)",
  },
  usageRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  usageTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  usageValue: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--foreground)",
    fontFamily: "monospace",
  },
  usageHint: {
    margin: 0,
    fontSize: 12,
    color: "var(--muted)",
  },
  usageTrack: {
    width: "100%",
    height: 8,
    borderRadius: 999,
    background: "var(--card-muted)",
    overflow: "hidden",
  },
  usageFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, var(--accent), var(--primary))",
    transition: "width 0.25s ease",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 20,
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--foreground)",
    letterSpacing: "0.01em",
  },
  labelHint: {
    fontSize: 12,
    color: "var(--muted)",
    fontWeight: 400,
    marginTop: 2,
  },
  input: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    fontSize: 14,
    color: "var(--foreground)",
    outline: "none",
    transition: "all 0.2s ease",
  },
  select: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    fontSize: 14,
    color: "var(--foreground)",
    outline: "none",
    cursor: "pointer",
  },
  textarea: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    fontSize: 14,
    color: "var(--foreground)",
    outline: "none",
    resize: "vertical" as const,
    minHeight: 120,
    fontFamily: "inherit",
    lineHeight: 1.5,
  },
  toggle: {
    position: "relative" as const,
    width: 52,
    height: 28,
    borderRadius: 14,
    background: "var(--border)",
    cursor: "pointer",
    transition: "all 0.3s ease",
    flexShrink: 0,
  },
  toggleActive: {
    background: "var(--accent)",
  },
  toggleKnob: {
    position: "absolute" as const,
    top: 2,
    left: 2,
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
    transition: "all 0.3s ease",
  },
  toggleKnobActive: {
    left: 26,
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 0",
    borderBottom: "1px solid var(--border)",
  },
  toggleRowLast: {
    borderBottom: "none",
  },
  toggleInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--foreground)",
  },
  toggleDescription: {
    fontSize: 13,
    color: "var(--muted)",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    padding: "16px 24px",
    borderTop: "1px solid var(--border)",
    background: "var(--card-muted)",
  },
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 24px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: "0 4px 14px rgba(0, 51, 160, 0.3)",
  },
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 24px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  btnDanger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 24px",
    borderRadius: 10,
    border: "none",
    background: "var(--danger)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  statusCard: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: 20,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--background)",
  },
  statusIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 12,
    flexShrink: 0,
  },
  statusConnected: {
    background: "rgba(16, 185, 129, 0.1)",
    color: "var(--success)",
  },
  statusDisconnected: {
    background: "rgba(239, 68, 68, 0.1)",
    color: "var(--danger)",
  },
  statusInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--foreground)",
  },
  statusDescription: {
    fontSize: 13,
    color: "var(--muted)",
  },
  timeInputs: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "end",
    gap: 16,
  },
  timeSeparator: {
    padding: "12px 0",
    fontSize: 14,
    color: "var(--muted)",
    fontWeight: 500,
  },
  toast: {
    position: "fixed" as const,
    bottom: 24,
    right: 24,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 20px",
    borderRadius: 12,
    background: "var(--foreground)",
    color: "var(--background)",
    fontSize: 14,
    fontWeight: 500,
    boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
    zIndex: 1000,
    animation: "slideUp 0.3s ease",
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   TOGGLE COMPONENT
───────────────────────────────────────────────────────────────────────────── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (val: boolean) => void }) {
  return (
    <div
      style={{ ...styles.toggle, ...(checked ? styles.toggleActive : {}) }}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onChange(!checked)}
    >
      <div style={{ ...styles.toggleKnob, ...(checked ? styles.toggleKnobActive : {}) }} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   TOAST COMPONENT
───────────────────────────────────────────────────────────────────────────── */
function Toast({ message, show }: { message: string; show: boolean }) {
  if (!show) return null;
  return (
    <div style={styles.toast}>
      <span style={{ color: "var(--success)" }}>{Icons.check}</span>
      {message}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   SETTINGS PAGE TABS
───────────────────────────────────────────────────────────────────────────── */
type SettingsTab = "profile" | "booking" | "tickets" | "integrations";

const tabConfig: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: Icons.user },
  { id: "booking", label: "Booking", icon: Icons.calendar },
  { id: "tickets", label: "Tickets", icon: Icons.ticket },
  { id: "integrations", label: "Integrations", icon: Icons.whatsapp },
];


/* ─────────────────────────────────────────────────────────────────────────────
   MAIN SETTINGS PAGE
───────────────────────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const auth = getFirebaseAuth();
  const [email, setEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [toast, setToast] = useState<string | null>(null);

  // Booking settings state
  const [unitCapacity, setUnitCapacity] = useState<number>(1);
  const [timeslotMinutes, setTimeslotMinutes] = useState<number>(60);
  const [openTime, setOpenTime] = useState<string>("09:00");
  const [closeTime, setCloseTime] = useState<string>("18:00");
  const [bookingsEnabled, setBookingsEnabled] = useState(false);
  const [promotionsEnabled, setPromotionsEnabled] = useState(true);
  const [timezone, setTimezone] = useState("UTC");
  const [ticketEnabledById, setTicketEnabledById] = useState<Record<string, boolean>>({});
  const [ticketRequiredFieldsById, setTicketRequiredFieldsById] = useState<Record<string, string>>({});
  const [savingAllTicketTypes, setSavingAllTicketTypes] = useState(false);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      setEmail(user?.email ?? null);
    });
    return () => unsub();
  }, [auth]);

  const userQuery = trpc.user.getMe.useQuery({ email: email ?? "" }, { enabled: !!email });
  const businessQuery = trpc.business.getMine.useQuery({ email: email ?? "" }, { enabled: !!email });
  const ticketTypesQuery = trpc.tickets.listTypes.useQuery({ includeDisabled: true }, { enabled: !!email });
  const updateBooking = trpc.business.updateBookingConfig.useMutation({
    onSuccess: () => {
      showToast("Settings saved successfully!");
      businessQuery.refetch();
    },
  });
  const upsertTicketType = trpc.tickets.upsertType.useMutation();
  const updateTimezone = trpc.business.updateTimezone.useMutation({
    onSuccess: () => {
      showToast("Timezone saved successfully!");
      businessQuery.refetch();
    },
  });

  useEffect(() => {
    if (businessQuery.data) {
      setUnitCapacity(businessQuery.data.bookingUnitCapacity ?? 1);
      setTimeslotMinutes(businessQuery.data.bookingTimeslotMinutes ?? 60);
      setOpenTime(businessQuery.data.bookingOpenTime ?? "09:00");
      setCloseTime(businessQuery.data.bookingCloseTime ?? "18:00");
      setBookingsEnabled(businessQuery.data.bookingsEnabled ?? false);
      setPromotionsEnabled(businessQuery.data.promotionsEnabled ?? true);
      const tz = (businessQuery.data.settings as Record<string, unknown> | null | undefined)?.timezone;
      setTimezone(typeof tz === "string" && tz ? tz : "UTC");
    }
  }, [businessQuery.data]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleLogout = async () => {
    if (!auth) {
      window.location.href = "/portal";
      return;
    }
    await signOut(auth);
    window.location.href = "/portal";
  };

  const handleSaveBookingSettings = () => {
    if (!email || !businessQuery.data?.id) return;
    updateBooking.mutate({
      email,
      businessId: businessQuery.data.id,
      unitCapacity,
      timeslotMinutes,
      openTime,
      closeTime,
    });
  };

  const handleSaveTimezone = () => {
    if (!email || !businessQuery.data?.id) return;
    updateTimezone.mutate({
      email,
      businessId: businessQuery.data.id,
      timezone,
    });
  };

  const normalizeTicketKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

  const getRequiredFieldsForTicket = (ticketType: {
    id: string;
    requiredFields?: string[] | null;
  }) => {
    const rawValue = ticketRequiredFieldsById[ticketType.id] ?? ((ticketType.requiredFields as string[]) ?? []).join(",");
    return String(rawValue)
      .split(",")
      .map((x) => normalizeTicketKey(x))
      .filter(Boolean);
  };

  const handleToggleTicketEnabled = async (
    ticketType: { id: string; enabled?: boolean; requiredFields?: string[] | null },
    nextEnabled: boolean,
  ) => {
    const previousEnabled = ticketEnabledById[ticketType.id] ?? (ticketType.enabled ?? true);
    setTicketEnabledById((prev) => ({ ...prev, [ticketType.id]: nextEnabled }));
    try {
      await upsertTicketType.mutateAsync({
        id: ticketType.id,
        enabled: nextEnabled,
        requiredFields: getRequiredFieldsForTicket(ticketType),
      });
      showToast("Ticket type updated");
      await ticketTypesQuery.refetch();
    } catch {
      setTicketEnabledById((prev) => ({ ...prev, [ticketType.id]: previousEnabled }));
      showToast("Failed to update ticket type");
    }
  };

  const handleSaveAllTicketTypes = async () => {
    if (!ticketTypesQuery.data?.length) return;
    setSavingAllTicketTypes(true);
    try {
      for (const ticketType of ticketTypesQuery.data) {
        const enabled = ticketEnabledById[ticketType.id] ?? (ticketType.enabled ?? true);
        await upsertTicketType.mutateAsync({
          id: ticketType.id,
          enabled,
          requiredFields: getRequiredFieldsForTicket(ticketType),
        });
      }
      showToast("All ticket fields saved");
      await ticketTypesQuery.refetch();
    } catch {
      showToast("Failed to save all ticket fields");
    } finally {
      setSavingAllTicketTypes(false);
    }
  };

  const getInitials = (email: string | null) => {
    if (!email) return "?";
    return email.substring(0, 2).toUpperCase();
  };

  const responsesUsed = Number(businessQuery.data?.responseUsage?.used ?? 0);
  const responsesMax = Number(businessQuery.data?.responseUsage?.max ?? 50_000);
  const responsesPercent = Math.min(100, Math.max(0, (responsesUsed / Math.max(1, responsesMax)) * 100));
  const fmtInt = (value: number) => value.toLocaleString("en-US");

  const renderProfileTab = () => (
    <div style={styles.section}>
      {/* Profile Card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardIcon}>{Icons.user}</div>
          <div>
            <h3 style={styles.cardTitle}>Profile Information</h3>
            <p style={styles.cardDescription}>Your personal account details</p>
          </div>
        </div>
        <div style={styles.cardBody}>
          <div style={styles.profileInfo}>
            <div style={styles.avatar}>{getInitials(email)}</div>
            <div style={styles.profileDetails}>
              <div style={styles.profileName}>{email?.split("@")[0] || "User"}</div>
              <div style={styles.profileEmail}>{email || "No email"}</div>
              <div style={styles.profileBadge}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
                Active Account
              </div>
            </div>
          </div>
        </div>
        <div style={styles.actions}>
          <button style={styles.btnDanger} onClick={handleLogout}>
            {Icons.logout}
            Sign Out
          </button>
        </div>
      </div>

      {/* Business Card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ ...styles.cardIcon, ...styles.cardIconSecondary }}>{Icons.building}</div>
          <div>
            <h3 style={styles.cardTitle}>Business Details</h3>
            <p style={styles.cardDescription}>Your organization information</p>
          </div>
        </div>
        <div style={styles.cardBody}>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Business Name</label>
              <input
                type="text"
                style={styles.input}
                value={businessQuery.data?.name || ""}
                readOnly
                placeholder="Business name"
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Business ID</label>
              <input
                type="text"
                style={{ ...styles.input, fontFamily: "monospace", fontSize: 12 }}
                value={businessQuery.data?.id || ""}
                readOnly
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Business Timezone (IANA)</label>
              <input
                type="text"
                style={styles.input}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. Asia/Kuala_Lumpur"
              />
            </div>
            <div style={styles.usageCard}>
              <div style={styles.usageRow}>
                <span style={styles.usageTitle}>AI Responses Used</span>
                <span style={styles.usageValue}>
                  {fmtInt(responsesUsed)} / {fmtInt(responsesMax)}
                </span>
              </div>
              <div style={styles.usageTrack}>
                <div style={{ ...styles.usageFill, width: `${responsesPercent}%` }} />
              </div>
              <p style={styles.usageHint}>
                Display only for beta. The bot is not blocked if usage goes above {fmtInt(responsesMax)}.
              </p>
            </div>
          </div>
        </div>
        <div style={styles.actions}>
          <button
            style={styles.btnPrimary}
            onClick={handleSaveTimezone}
            disabled={updateTimezone.isPending}
          >
            {Icons.save}
            {updateTimezone.isPending ? "Saving..." : "Save Timezone"}
          </button>
        </div>
      </div>

      {/* AI Bot Instructions */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardIcon}>{Icons.bot}</div>
          <div>
            <h3 style={styles.cardTitle}>AI Assistant Instructions</h3>
            <p style={styles.cardDescription}>Customize your AI bot&apos;s behavior and personality</p>
          </div>
        </div>
        <div style={styles.cardBody}>
          <div style={styles.formGroup}>
            <label style={styles.label}>
              System Instructions
              <p style={styles.labelHint}>These instructions guide how your AI assistant responds to customers</p>
            </label>
            <textarea
              style={styles.textarea}
              value={businessQuery.data?.instructions || ""}
              readOnly
              placeholder="AI instructions..."
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderBookingTab = () => (
    <div style={styles.section}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardIcon}>{Icons.calendar}</div>
          <div>
            <h3 style={styles.cardTitle}>Booking Configuration</h3>
            <p style={styles.cardDescription}>Configure your booking system settings</p>
          </div>
        </div>
        <div style={styles.cardBody}>
          {/* Toggle Section */}
          <div style={{ ...styles.toggleRow }}>
            <div style={styles.toggleInfo}>
              <span style={styles.toggleLabel}>Enable Bookings</span>
              <span style={styles.toggleDescription}>Allow customers to book appointments through WhatsApp</span>
            </div>
            <Toggle checked={bookingsEnabled} onChange={setBookingsEnabled} />
          </div>

          {/* Capacity and Timeslot */}
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Slot Capacity
                <p style={styles.labelHint}>Max bookings per time slot</p>
              </label>
              <input
                type="number"
                style={styles.input}
                min={1}
                value={unitCapacity}
                onChange={(e) => setUnitCapacity(parseInt(e.target.value) || 1)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Timeslot Duration
                <p style={styles.labelHint}>Length of each booking slot</p>
              </label>
              <PortalSelect
                value={String(timeslotMinutes)}
                onValueChange={(value) => setTimeslotMinutes(parseInt(value, 10))}
                options={[
                  { value: "15", label: "15 minutes" },
                  { value: "30", label: "30 minutes" },
                  { value: "45", label: "45 minutes" },
                  { value: "60", label: "1 hour" },
                  { value: "90", label: "1.5 hours" },
                  { value: "120", label: "2 hours" },
                ]}
                style={styles.select}
                ariaLabel="Timeslot duration"
              />
            </div>
          </div>

          {/* Business Hours */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              Business Hours
              <p style={styles.labelHint}>When customers can book appointments</p>
            </label>
            <div style={styles.timeInputs}>
              <div style={styles.formGroup}>
                <label style={{ ...styles.label, fontSize: 12, color: "var(--muted)" }}>Opening Time</label>
                <input
                  type="time"
                  style={styles.input}
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                />
              </div>
              <span style={styles.timeSeparator}>to</span>
              <div style={styles.formGroup}>
                <label style={{ ...styles.label, fontSize: 12, color: "var(--muted)" }}>Closing Time</label>
                <input
                  type="time"
                  style={styles.input}
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
        <div style={styles.actions}>
          <button style={styles.btnSecondary} onClick={() => businessQuery.refetch()}>
            Cancel
          </button>
          <button 
            style={styles.btnPrimary} 
            onClick={handleSaveBookingSettings}
            disabled={updateBooking.isPending}
          >
            {Icons.save}
            {updateBooking.isPending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );

  const renderTicketsTab = () => (
    <div style={styles.section}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ ...styles.cardIcon, ...styles.cardIconSecondary }}>{Icons.ticket}</div>
          <div>
            <h3 style={styles.cardTitle}>Ticket Fields</h3>
            <p style={styles.cardDescription}>Fixed ticket types. Only required fields and enable toggle are editable.</p>
          </div>
        </div>
        <div style={{ ...styles.cardBody, padding: 12 }}>
          {!ticketTypesQuery.data?.length ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>No ticket types configured yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {ticketTypesQuery.data.map((ticketType) => {
                const initialFields = ticketRequiredFieldsById[ticketType.id] ?? ((ticketType.requiredFields as string[]) ?? []).join(",");
                const isEnabled = ticketEnabledById[ticketType.id] ?? (ticketType.enabled ?? true);
                return (
                <div
                  key={ticketType.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    display: "grid",
                    gridTemplateColumns: "180px minmax(260px, 1fr) auto",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{ticketType.label}</div>
                    <div style={{ color: "var(--muted)", fontSize: 11, fontFamily: "monospace" }}>{ticketType.key}</div>
                  </div>
                  <div>
                    <input
                      type="text"
                      style={{ ...styles.input, height: 36, fontSize: 13 }}
                      value={initialFields}
                      onChange={(e) =>
                        setTicketRequiredFieldsById((prev) => ({
                          ...prev,
                          [ticketType.id]: e.target.value,
                        }))
                      }
                      placeholder="orderid,phonenumber"
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Toggle
                      checked={isEnabled}
                      onChange={(next) => void handleToggleTicketEnabled(ticketType, next)}
                    />
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
        {!!ticketTypesQuery.data?.length && (
          <div style={styles.actions}>
            <button
              style={styles.btnPrimary}
              onClick={() => void handleSaveAllTicketTypes()}
              disabled={savingAllTicketTypes}
            >
              {Icons.save}
              {savingAllTicketTypes ? "Saving..." : "Save All"}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderIntegrationsTab = () => {
    const isConnected = userQuery.data?.whatsappConnected;

    return (
      <div style={styles.section}>
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={{ ...styles.cardIcon, background: "linear-gradient(135deg, #25D366, #128C7E)" }}>
              {Icons.whatsapp}
            </div>
            <div>
              <h3 style={styles.cardTitle}>WhatsApp Business</h3>
              <p style={styles.cardDescription}>Connect your WhatsApp Business account</p>
            </div>
          </div>
          <div style={styles.cardBody}>
            <div style={styles.statusCard}>
              <div style={{ ...styles.statusIcon, ...(isConnected ? styles.statusConnected : styles.statusDisconnected) }}>
                {isConnected ? Icons.check : Icons.whatsapp}
              </div>
              <div style={styles.statusInfo}>
                <span style={styles.statusTitle}>
                  {isConnected ? "WhatsApp Connected" : "WhatsApp Not Connected"}
                </span>
                <span style={styles.statusDescription}>
                  {isConnected 
                    ? "Your WhatsApp Business account is linked and receiving messages" 
                    : "Connect your WhatsApp Business account to start receiving messages"}
                </span>
              </div>
              <button 
                style={isConnected ? styles.btnSecondary : styles.btnPrimary}
                onClick={() => window.location.href = "/portal/sync"}
              >
                {isConnected ? "Manage" : "Connect"}
              </button>
            </div>
          </div>
        </div>

        {/* Future Integrations Placeholder */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.cardIcon}>{Icons.toggle}</div>
            <div>
              <h3 style={styles.cardTitle}>Other Integrations</h3>
              <p style={styles.cardDescription}>Connect additional services</p>
            </div>
          </div>
          <div style={styles.cardBody}>
            <div style={{ ...styles.toggleRow }}>
              <div style={styles.toggleInfo}>
                <span style={styles.toggleLabel}>Enable Promotions</span>
                <span style={styles.toggleDescription}>Allow AI to suggest promotions to customers</span>
              </div>
              <Toggle checked={promotionsEnabled} onChange={setPromotionsEnabled} />
            </div>
            <div style={{ ...styles.toggleRow, ...styles.toggleRowLast }}>
              <div style={styles.toggleInfo}>
                <span style={styles.toggleLabel}>Calendar Sync</span>
                <span style={styles.toggleDescription}>Sync bookings with Google Calendar (Coming Soon)</span>
              </div>
              <Toggle checked={false} onChange={() => {}} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return renderProfileTab();
      case "booking":
        return renderBookingTab();
      case "tickets":
        return renderTicketsTab();
      case "integrations":
        return renderIntegrationsTab();
      default:
        return null;
    }
  };

  if (!email) {
    return (
      <div style={{ ...styles.page, paddingTop: 80, textAlign: "center" }}>
        <div className="card" style={{ padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <h2 style={{ marginBottom: 8 }}>Loading...</h2>
          <p style={{ color: "var(--muted)" }}>Please wait while we load your settings</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Tabs */}
      <div style={styles.tabs}>
        {tabConfig.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            <span style={{ opacity: activeTab === tab.id ? 1 : 0.6 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ animation: "fadeIn 0.3s ease" }}>
        {renderTabContent()}
      </div>

      {/* Toast */}
      <Toast message={toast || ""} show={!!toast} />
    </div>
  );
}
