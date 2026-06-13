"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Calendar,
  CheckCircle,
  CreditCard,
  RefreshCw,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { useAuthSubscription } from "@/contexts/AuthSubscriptionContext";
import { useScopedVenue } from "@/hooks/useScopedVenue";
import { fetchWithFirebaseAuth } from "@/lib/client-auth-ops";
import { trpc } from "@/utils/trpc";
import { useToast } from "@/components/ToastProvider";

interface SubscriptionData {
  hasSubscription: boolean;
  status: string;
  planCode: string | null;
  planName: string | null;
  grantKind: string | null;
  subscriptionStatus: string | null;
  lastPaidAt: string | Date | null;
  nextDueAt: string | Date | null;
  monthlyCredits: number;
  creditsUsed: number;
  creditsBalance: number;
  priceAmount: number;
  currency: string;
  features: Record<string, boolean>;
  limits: Record<string, number | string | boolean | null>;
  isActive: boolean;
  isSpecialGrant: boolean;
}

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  AGENT_BASIC: "Agent Basic",
  AGENT_GROWTH: "Agent Growth",
  AGENT_ENTERPRISE: "Agent Enterprise",
  BUNDLE_CORE: "Pro Bundle",
  BUNDLE_FULL: "Full Bundle",
  DEMO_FULL_ACCESS: "Demo Access",
  PARTNER_FULL_ACCESS: "Partner Full Access",
};

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  active: { bg: "bg-emerald-500/20", text: "text-emerald-400", icon: CheckCircle },
  past_due: { bg: "bg-amber-500/20", text: "text-amber-400", icon: AlertCircle },
  pending_setup: { bg: "bg-blue-500/20", text: "text-blue-400", icon: Calendar },
  cancelled: { bg: "bg-red-500/20", text: "text-red-400", icon: AlertCircle },
  none: { bg: "bg-gray-500/20", text: "text-gray-400", icon: CreditCard },
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  past_due: "Past Due",
  pending_setup: "Pending Setup",
  cancelled: "Cancelled",
  none: "No Subscription",
};

const AGENT_PLAN_FEATURES: Record<string, string[]> = {
  AGENT_BASIC: ["1 WhatsApp Business number", "Up to 10 team members", "AI-powered responses", "Basic analytics dashboard", "30,000 messages/month", "Email support", "SenangPay integration"],
  AGENT_GROWTH: ["Up to 3 WhatsApp Business numbers", "Up to 10 team members", "AI-powered responses with custom prompts", "Advanced analytics & reporting", "50,000 messages/month", "Priority email support", "API access", "Webhook integrations"],
  AGENT_ENTERPRISE: ["Up to 10 WhatsApp Business numbers", "Unlimited team members", "Custom AI model training", "Advanced analytics & BI", "100,000 messages/month", "Dedicated account manager", "SLA guarantee", "White-label option"],
  BUNDLE_CORE: ["1 WhatsApp Business number", "AI-powered responses", "30,000 messages/month", "Agent analytics dashboard", "Agent widget management", "Priority support"],
  BUNDLE_FULL: ["Up to 3 WhatsApp Business numbers", "AI-powered responses", "50,000 messages/month", "Advanced agent analytics", "Agent widget management", "Priority support"],
  DEMO_FULL_ACCESS: ["Up to 10 WhatsApp Business numbers", "AI-powered responses", "50,000 messages/month", "Advanced agent analytics", "Agent widget management"],
  PARTNER_FULL_ACCESS: ["Up to 10 WhatsApp Business numbers", "AI-powered responses", "50,000 messages/month", "Advanced agent analytics", "Agent widget management"],
};

function formatLimit(value: number | string | boolean | null | undefined): string {
  if (value === null || value === undefined || value === -1 || value === "unlimited") return "Unlimited";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

export function SubscriptionContent() {
  const { subscription: cachedSubscription } = useAuthSubscription();
  const { businessId, businessQuery } = useScopedVenue();
  const toast = useToast();
  const [refreshedSubscription, setRefreshedSubscription] = useState<SubscriptionData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const subscriptionQuery = trpc.business.getSubscription.useQuery(undefined, {
    enabled: Boolean(businessId && !cachedSubscription),
    refetchOnWindowFocus: false,
  });

  const subscription = refreshedSubscription ?? cachedSubscription ?? subscriptionQuery.data ?? null;
  const loading = !subscription && (businessQuery.isLoading || subscriptionQuery.isLoading || !businessId);
  const canManagePaidPlan = Boolean(
    subscription?.isActive
      && subscription.planCode
      && !subscription.isSpecialGrant
      && subscription.priceAmount > 0,
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    const result = await subscriptionQuery.refetch();
    if (result.data) setRefreshedSubscription(result.data);
    setRefreshing(false);
    toast.show({ type: "success", title: "Refreshed", message: "Subscription data updated" });
  };

  const handleManagePlan = async () => {
    if (!canManagePaidPlan || !subscription?.planCode) return;
    const response = await fetchWithFirebaseAuth(
      "/api/billing/recurring-checkout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode: subscription.planCode }),
      },
      { action: "create-recurring-checkout", area: "billing" },
    );
    const data = await response.json();
    if (data.checkoutUrl) window.location.href = data.checkoutUrl;
  };

  if (loading) {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      </div>
    );
  }

  if (!subscription) {
    return <div className="py-16 text-center text-gray-400">Unable to load subscription data</div>;
  }

  const statusStyle = STATUS_STYLES[subscription.status] ?? STATUS_STYLES.none;
  const StatusIcon = statusStyle.icon;
  const features = AGENT_PLAN_FEATURES[subscription.planCode ?? ""] ?? [];
  const creditPercent = subscription.monthlyCredits > 0
    ? Math.min(100, (subscription.creditsUsed / subscription.monthlyCredits) * 100)
    : 0;
  const formatDate = (date: string | Date | null) => date
    ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "N/A";

  return (
    <div className="space-y-6 bg-[#1A2332] text-white">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">Agent Platform</p>
          <h1 className="text-3xl font-bold">Subscription &amp; Billing</h1>
          <p className="mt-1 text-slate-400">Manage your agent subscription, message credits, limits, and billing details</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-[#253044] px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <section className={`rounded-2xl border-2 p-6 ${subscription.isActive ? "border-emerald-500/30 bg-emerald-500/10" : "border-slate-700 bg-[#253044]"}`}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${statusStyle.bg}`}>
              <StatusIcon className={`h-8 w-8 ${statusStyle.text}`} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold">
                  {subscription.planName ? PLAN_DISPLAY_NAMES[subscription.planName] ?? subscription.planName : "No Active Plan"}
                </h2>
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                  {STATUS_LABELS[subscription.status] ?? subscription.status}
                </span>
                {subscription.isSpecialGrant ? (
                  <span className="rounded-full bg-purple-500/20 px-3 py-1 text-sm font-medium text-purple-400">
                    {subscription.grantKind === "demo" ? "Demo Access" : "Partner Access"}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-slate-400">
                Plan: <span className="font-medium text-white">{subscription.planCode ?? "N/A"}</span>
              </p>
            </div>
          </div>

          <div className="flex min-w-48 items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/30 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20">
              <Calendar className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Next Payment</p>
              <p className="text-lg font-bold">{formatDate(subscription.nextDueAt)}</p>
            </div>
          </div>
        </div>

        {canManagePaidPlan ? (
          <div className="mt-6 border-t border-slate-700 pt-6">
            <button
              type="button"
              onClick={() => void handleManagePlan()}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 font-semibold transition hover:bg-emerald-700 sm:w-auto"
            >
              <Settings className="h-4 w-4" />
              Manage Plan / Upgrade
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="overflow-hidden rounded-2xl border border-slate-700 bg-[#253044] lg:col-span-2">
          <div className="border-b border-slate-700 p-5">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Shield className="h-5 w-5 text-emerald-400" />
              Plan Features
            </h3>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {features.length ? features.map((feature) => (
              <div key={feature} className="flex items-center gap-3 text-sm text-slate-300">
                <CheckCircle className="h-5 w-5 shrink-0 text-emerald-400" />
                <span>{feature}</span>
              </div>
            )) : (
              <p className="text-sm text-slate-400">No feature details available for this plan.</p>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-700 bg-[#253044]">
          <div className="border-b border-slate-700 p-5">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5 text-emerald-400" />
              Limits &amp; Usage
            </h3>
          </div>
          <div className="space-y-5 p-5">
            <div>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-slate-400">Message Credits</span>
                <span className="font-medium">{subscription.creditsUsed.toLocaleString()} / {subscription.monthlyCredits.toLocaleString()}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${creditPercent}%` }} />
              </div>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-slate-400">AI Agents</span>
              <span className="font-medium">{formatLimit(subscription.limits["agent.agents.max"])}</span>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-slate-400">WhatsApp Numbers</span>
              <span className="font-medium">{formatLimit(subscription.limits["agent.whatsappNumbers.max"])}</span>
            </div>
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-[#1A2332]">
        <div className="flex items-center justify-between border-b border-slate-700 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Calendar className="h-5 w-5 text-emerald-400" />
            Billing History
          </h3>
          <span className="flex items-center gap-1 text-sm text-emerald-400">View All <ArrowUpRight className="h-3 w-3" /></span>
        </div>
        <div className="p-5">
          {subscription.lastPaidAt ? (
            <div className="grid gap-3 rounded-xl bg-[#253044] p-4 text-sm sm:grid-cols-3">
              <span>{formatDate(subscription.lastPaidAt)}</span>
              <span>{subscription.planName ?? subscription.planCode}</span>
              <span className="text-emerald-400">Paid</span>
            </div>
          ) : (
            <div className="py-8 text-center">
              <CreditCard className="mx-auto mb-4 h-12 w-12 text-slate-600" />
              <p className="text-slate-400">Billing history will appear here after your first payment.</p>
              <p className="mt-1 text-sm text-slate-500">Payments are processed through SenangPay recurring billing.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
