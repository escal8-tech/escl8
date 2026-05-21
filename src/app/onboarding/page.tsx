"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/utils/trpc";

const CATEGORY_OPTIONS = [
  { id: "commerce", label: "Retail / commerce", active: true },
  { id: "restaurant", label: "Restaurant / cafe", active: true },
  { id: "wellness", label: "Wellness & beauty", active: true },
  { id: "sports", label: "Sports venue", active: true },
  { id: "hotel", label: "Hotel / rooms", active: true },
  { id: "clinic", label: "Clinic", active: false },
  { id: "landlord", label: "Landlord / rentals", active: false },
];

const SERVICE_OPTIONS = [
  "Customer support",
  "Order taking",
  "Payment follow-up",
  "Bookings",
  "Product catalog",
  "Haircuts & styling",
  "Sports coaching",
  "Hotel guest service",
  "Cafe reservations",
  "Other",
];

const RESOURCE_OPTIONS = ["table", "room", "court", "chair", "staff", "delivery"];
const TEAM_INVITE_HINTS = ["Owners stay admins.", "Teammates must use invite links.", "You can promote users later from Settings."];

function toggle(list: string[], value: string, max = 8) {
  if (list.includes(value)) return list.filter((item) => item !== value);
  if (list.length >= max) return list;
  return [...list, value];
}

function OnboardingCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: "100%", maxWidth: 920, border: "1px solid var(--border)", borderRadius: 24, padding: "clamp(1.25rem, 3vw, 2.5rem)", background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))", boxShadow: "0 24px 80px rgba(2,6,23,.18)" }}>
      {children}
    </div>
  );
}

export default function AgentOnboardingPage() {
  const router = useRouter();
  const setupQuery = trpc.business.getSetupStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const completeSetup = trpc.business.completeOnboardingSetup.useMutation();
  const existing = setupQuery.data?.onboarding as Record<string, unknown> | undefined;
  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [website, setWebsite] = useState("");
  const [primaryCategory, setPrimaryCategory] = useState(String(existing?.primaryCategory || "commerce"));
  const [categories, setCategories] = useState<string[]>(Array.isArray(existing?.categories) ? existing.categories.map(String) : []);
  const [serviceTypes, setServiceTypes] = useState<string[]>(Array.isArray(existing?.serviceTypes) ? existing.serviceTypes.map(String) : []);
  const [resourceTypes, setResourceTypes] = useState<string[]>(Array.isArray(existing?.resourceTypes) ? existing.resourceTypes.map(String) : []);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [error, setError] = useState<string | null>(null);
  const progress = useMemo(() => Math.round(((step + 1) / 5) * 100), [step]);

  const next = async () => {
    setError(null);
    if (step === 0 && !businessName.trim()) {
      setError("Business name is required.");
      return;
    }
    if (step === 1 && (!primaryCategory || serviceTypes.length === 0)) {
      setError("Choose a primary category and at least one service type.");
      return;
    }
    if (step === 3 && !timezone.trim()) {
      setError("Timezone is required.");
      return;
    }
    if (step < 4) {
      setStep((current) => current + 1);
      return;
    }
    await completeSetup.mutateAsync({ businessName, website, phone, address, timezone, primaryCategory, categories: categories.length ? categories : [primaryCategory], serviceTypes, resourceTypes });
    router.push("/upload");
    router.refresh();
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", padding: "clamp(1rem, 4vw, 3rem)", display: "grid", placeItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 1100 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 34 }}>
          {Array.from({ length: 5 }).map((_, index) => <div key={index} style={{ height: 5, borderRadius: 999, background: index <= step ? "linear-gradient(90deg, var(--gold), var(--accent-gold, #D4A84B))" : "var(--border)" }} />)}
        </div>
        <OnboardingCard>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>Account setup · {progress}%</p>
          {step === 0 ? (
            <div>
              <h1 style={{ fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1.05, margin: "10px 0 12px" }}>What&apos;s your business name?</h1>
              <p style={{ color: "var(--muted)", fontSize: 18, maxWidth: 680 }}>This is the brand name customers and staff will see. Billing/legal details can be added later.</p>
              <div style={{ display: "grid", gap: 16, marginTop: 34 }}>
                <label style={{ display: "grid", gap: 8, fontWeight: 700 }}>Business name<input className="contact-input" value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoFocus /></label>
                <label style={{ display: "grid", gap: 8, fontWeight: 700 }}>Website <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span><input className="contact-input" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="www.yoursite.com" /></label>
              </div>
            </div>
          ) : null}
          {step === 1 ? (
            <div>
              <h1 style={{ fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1.05, margin: "10px 0 12px" }}>What services do you offer?</h1>
              <p style={{ color: "var(--muted)", fontSize: 18 }}>Pick a primary category and the service areas Escal8 should prepare for.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginTop: 28 }}>
                {CATEGORY_OPTIONS.map((option) => {
                  const selected = primaryCategory === option.id || categories.includes(option.id);
                  return <button key={option.id} type="button" disabled={!option.active} onClick={() => { if (!option.active) return; setPrimaryCategory(option.id); setCategories((current) => toggle(current, option.id, 4)); }} style={{ minHeight: 98, borderRadius: 16, border: selected ? "2px solid var(--gold)" : "1px solid var(--border)", background: option.active ? "rgba(255,255,255,.035)" : "rgba(148,163,184,.08)", color: option.active ? "var(--foreground)" : "var(--muted)", textAlign: "left", padding: 18, cursor: option.active ? "pointer" : "not-allowed", opacity: option.active ? 1 : 0.48 }}><strong>{option.label}</strong>{primaryCategory === option.id ? <span style={{ marginLeft: 8, color: "var(--gold)" }}>Primary</span> : null}</button>;
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 22 }}>
                {SERVICE_OPTIONS.map((service) => <button key={service} type="button" onClick={() => setServiceTypes((current) => toggle(current, service, 6))} className="btn" style={{ justifyContent: "flex-start", borderColor: serviceTypes.includes(service) ? "var(--gold)" : undefined }}>{serviceTypes.includes(service) ? "✓ " : ""}{service}</button>)}
              </div>
            </div>
          ) : null}
          {step === 2 ? (
            <div>
              <h1 style={{ fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1.05, margin: "10px 0 12px" }}>What resources should we prepare?</h1>
              <p style={{ color: "var(--muted)", fontSize: 18 }}>These hints help us prepare calendars, widgets, and future floor/resource defaults.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginTop: 28 }}>
                {RESOURCE_OPTIONS.map((resource) => <button key={resource} type="button" onClick={() => setResourceTypes((current) => toggle(current, resource, 8))} className="btn" style={{ minHeight: 86, justifyContent: "flex-start", borderColor: resourceTypes.includes(resource) ? "var(--gold)" : undefined }}>{resourceTypes.includes(resource) ? "✓ " : ""}{resource}</button>)}
              </div>
            </div>
          ) : null}
          {step === 3 ? (
            <div>
              <h1 style={{ fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1.05, margin: "10px 0 12px" }}>Set your location</h1>
              <p style={{ color: "var(--muted)", fontSize: 18 }}>This powers customer-facing contact details, schedule times, and receipts.</p>
              <div style={{ display: "grid", gap: 16, marginTop: 34 }}>
                <input className="contact-input" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Business address" />
                <input className="contact-input" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Business phone" />
                <input className="contact-input" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Colombo" />
              </div>
            </div>
          ) : null}
          {step === 4 ? (
            <div>
              <h1 style={{ fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1.05, margin: "10px 0 12px" }}>Invite your team when ready</h1>
              <p style={{ color: "var(--muted)", fontSize: 18 }}>No one should manually pick your business. Admins invite users, then promote them later.</p>
              <div style={{ display: "grid", gap: 12, marginTop: 28 }}>{TEAM_INVITE_HINTS.map((hint) => <div key={hint} className="panel" style={{ padding: 18 }}>✓ {hint}</div>)}</div>
            </div>
          ) : null}
          {error ? <p style={{ color: "var(--danger)", marginTop: 18 }}>{error}</p> : null}
          {completeSetup.isError ? <p style={{ color: "var(--danger)", marginTop: 18 }}>{completeSetup.error.message}</p> : null}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 34 }}>
            <button className="btn" type="button" disabled={step === 0 || completeSetup.isPending} onClick={() => setStep((current) => Math.max(0, current - 1))}>Back</button>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {step === 4 ? <button className="btn" type="button" onClick={() => router.push("/upload")}>Skip for now</button> : null}
              <button className="btn btn-primary" type="button" disabled={completeSetup.isPending} onClick={() => void next()}>{completeSetup.isPending ? "Saving..." : step === 4 ? "Finish setup" : "Continue"}</button>
            </div>
          </div>
        </OnboardingCard>
      </div>
    </div>
  );
}
