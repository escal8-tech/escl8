"use client";

import { useState } from "react";
import { trpc } from "@/utils/trpc";
import { useScopedVenue } from "@/hooks/useScopedVenue";
import { useSearchParams } from "next/navigation";
import {
  CreditCard,
  Calendar,
  Crown,
  AlertCircle,
  CheckCircle,
  Zap,
  Users,
  Settings,
  RefreshCw,
  MessageSquare,
} from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { useAuthSubscription } from "@/contexts/AuthSubscriptionContext";
import { fetchWithFirebaseAuth } from "@/lib/client-auth-ops";

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
  PARTNER_FULL_ACCESS: "Partner Access",
};

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
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
  AGENT_BASIC: [
    "1 WhatsApp Business number",
    "Up to 10 team members",
    "AI-powered responses",
    "Basic analytics dashboard",
    "30,000 messages/month",
    "Email support",
    "SenangPay integration",
  ],
  AGENT_GROWTH: [
    "Up to 3 WhatsApp Business numbers",
    "Up to 10 team members",
    "AI-powered responses with custom prompts",
    "Advanced analytics & reporting",
    "50,000 messages/month",
    "Priority email support",
    "SenangPay integration",
    "API access",
    "Webhook integrations",
  ],
  AGENT_ENTERPRISE: [
    "Up to 10 WhatsApp Business numbers",
    "Unlimited team members",
    "Custom AI model training",
    "Advanced analytics & BI",
    "100,000 messages/month",
    "Dedicated account manager",
    "SLA guarantee",
    "API access with higher limits",
    "Custom webhook integrations",
    "White-label option",
  ],
  BUNDLE_CORE: [
    "1 WhatsApp Business number",
    "AI-powered responses",
    "30,000 messages/month",
    "Agent analytics dashboard",
    "Agent widget management",
    "Priority support",
  ],
  BUNDLE_FULL: [
    "Up to 3 WhatsApp Business numbers",
    "AI-powered responses",
    "50,000 messages/month",
    "Advanced agent analytics",
    "Agent widget management",
    "Priority support",
  ],
  DEMO_FULL_ACCESS: [
    "Up to 10 WhatsApp Business numbers",
    "AI-powered responses",
    "50,000 messages/month",
    "Advanced agent analytics",
    "Agent widget management",
  ],
  PARTNER_FULL_ACCESS: [
    "Up to 10 WhatsApp Business numbers",
    "AI-powered responses",
    "50,000 messages/month",
    "Advanced agent analytics",
    "Agent widget management",
  ],
};

export function SubscriptionContent() {
  const searchParams = useSearchParams();
  const { subscription: cachedSubscription } = useAuthSubscription();

  const { businessId } = useScopedVenue();
  const toast = useToast();

  const initialSubscription = cachedSubscription;
  const [refreshedSubscription, setRefreshedSubscription] = useState<SubscriptionData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [planFamily, setPlanFamily] = useState<"agent" | "bundle">("agent");

  const subscriptionQuery = trpc.business.getSubscription.useQuery(
    undefined,
    { enabled: !!businessId && !initialSubscription, refetchOnWindowFocus: false }
  );

  const subscription = refreshedSubscription ?? initialSubscription ?? subscriptionQuery.data ?? null;
  const loading = !subscription && subscriptionQuery.isLoading;

  const handleRefresh = async () => {
    setRefreshing(true);
    const result = await subscriptionQuery.refetch();
    if (result.data) setRefreshedSubscription(result.data);
    setRefreshing(false);
    toast.show({ type: "success", title: "Refreshed", message: "Subscription data updated" });
  };

  const handleManagePlan = () => {
    if (subscription?.planCode) {
      fetchWithFirebaseAuth("/api/billing/recurring-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode: subscription.planCode }),
      }, { action: "create-recurring-checkout", area: "billing" })
        .then((res) => res.json())
        .then((data) => {
          if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
          } else {
            console.error("Checkout failed:", data.error);
          }
        })
        .catch((err) => console.error("Checkout error:", err));
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-[#1A2332]">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-[#1A2332]">
        <p className="text-gray-600 dark:text-gray-400">Unable to load subscription data</p>
      </div>
    );
  }

  const statusConfig = STATUS_COLORS[subscription.status] || STATUS_COLORS.none;
  const StatusIcon = statusConfig.icon;
  const isActive = subscription.isActive;

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "N/A";
    try {
      const d = new Date(date);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "Invalid date";
    }
  };

  return (
    <div className="flex h-full bg-white dark:bg-[#1A2332]">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400 mb-1">
              Agent Platform
            </p>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Subscription &amp; Billing
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Manage your agent subscription, view credits, and billing details
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#253044] border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Current Subscription Card */}
        <div
          className={`
            rounded-2xl border-2 p-6 transition-all ${
              isActive
                ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#253044]"
            }
          `}
        >
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className={`flex items-center justify-center w-16 h-16 rounded-2xl ${statusConfig.bg}`}>
                <StatusIcon className={`w-8 h-8 ${statusConfig.text}`} />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {subscription.planName
                      ? PLAN_DISPLAY_NAMES[subscription.planName] || subscription.planName
                      : "No Active Plan"}
                  </h2>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusConfig.bg} ${statusConfig.text}`}>
                    {STATUS_LABELS[subscription.status] || subscription.status}
                  </span>
                  {subscription.isSpecialGrant && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-500/20 text-purple-400">
                      {subscription.grantKind === "demo" ? "Demo Access" : "Partner Access"}
                    </span>
                  )}
                </div>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  Plan:{" "}
                  <span className="font-medium text-gray-900 dark:text-white">{subscription.planCode || "N/A"}</span>
                  {subscription.priceAmount > 0 && (
                    <>
                      {" • "}
                      {formatCurrency(subscription.priceAmount, subscription.currency)}/{" "}
                      {subscription.currency === "MYR" ? "month" : "month"}
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              {/* Next Billing Date */}
              <div className="flex items-center gap-3 p-4 bg-white/50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700 min-w-[200px]">
                <div className="flex items-center justify-center w-10 h-10 bg-emerald-500/20 rounded-lg">
                  <Calendar className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.05em] text-gray-500 dark:text-gray-400">Next Payment</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">
                    {subscription.nextDueAt ? formatDate(subscription.nextDueAt) : "N/A"}
                  </p>
                </div>
              </div>

              {/* Monthly Credits */}
              <div className="flex items-center gap-3 p-4 bg-white/50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700 min-w-[200px]">
                <div className="flex items-center justify-center w-10 h-10 bg-blue-500/20 rounded-lg">
                  <Zap className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.05em] text-gray-500 dark:text-gray-400">Monthly Credits</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-gray-900 dark:text-white">
                      {subscription.monthlyCredits.toLocaleString()}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">/month</span>
                  </div>
                </div>
              </div>

              {/* Credits Usage */}
              {subscription.monthlyCredits > 0 && (
                <div className="flex items-center gap-3 p-4 bg-white/50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700 min-w-[200px]">
                  <div className="flex items-center justify-center w-10 h-10 bg-purple-500/20 rounded-lg">
                    <Crown className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.05em] text-gray-500 dark:text-gray-400">Credits Used</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-gray-900 dark:text-white">
                        {subscription.creditsUsed.toLocaleString()}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400">/ {subscription.monthlyCredits.toLocaleString()}</span>
                    </div>
                    <div className="mt-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden w-32">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500"
                        style={{
                          width: `${
                            subscription.monthlyCredits > 0
                              ? Math.min(100, (subscription.creditsUsed / subscription.monthlyCredits) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Team Members */}
              <div className="flex items-center gap-3 p-4 bg-white/50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700 min-w-[180px]">
                <div className="flex items-center justify-center w-10 h-10 bg-orange-500/20 rounded-lg">
                  <Users className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.05em] text-gray-500 dark:text-gray-400">AI Agents</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">
                    {subscription.limits?.["agent.agents.max"] ?? "Unlimited"}
                  </p>
                </div>
              </div>

              {/* WhatsApp Numbers */}
              <div className="flex items-center gap-3 p-4 bg-white/50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700 min-w-[180px]">
                <div className="flex items-center justify-center w-10 h-10 bg-green-500/20 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.05em] text-gray-500 dark:text-gray-400">WhatsApp Numbers</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">
                    {subscription.limits?.["agent.whatsappNumbers.max"] || "Unlimited"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Manage Plan Button */}
          {isActive && subscription.planCode && (
            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleManagePlan}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-colors"
              >
                <Settings className="w-4 h-4" />
                Manage Plan / Upgrade
              </button>
            </div>
          )}
        </div>

        {/* Plan Features */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#253044] p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Current Plan Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {subscription.planCode && AGENT_PLAN_FEATURES[subscription.planCode]?.map((feature, index) => (
              <div key={index} className="flex items-start gap-3 text-gray-700 dark:text-gray-300">
                <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing Tiers Overview */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#253044] p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Available Plans</h2>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900">
              {(["agent", "bundle"] as const).map((family) => (
                <button
                  key={family}
                  type="button"
                  onClick={() => setPlanFamily(family)}
                  className={`rounded-md px-4 py-2 text-sm font-semibold ${
                    planFamily === family
                      ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {family === "agent" ? "Agent Plans" : "Bundle Plans"}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            Monthly billing. Yearly plans will appear after their SenangPay recurring products are configured.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { code: "AGENT_BASIC", name: "Agent Basic", price: 349, popular: false },
              { code: "AGENT_GROWTH", name: "Agent Growth", price: 599, popular: true },
              { code: "AGENT_ENTERPRISE", name: "Agent Enterprise", price: 0, popular: false, enterprise: true },
              { code: "BUNDLE_CORE", name: "Pro Bundle", price: 799, popular: false },
              { code: "BUNDLE_FULL", name: "Full Bundle", price: 1199, popular: false },
            ].filter((plan) => planFamily === "bundle" ? plan.code.startsWith("BUNDLE_") : plan.code.startsWith("AGENT_")).map((plan) => (
              <div
                key={plan.code}
                className={`
                  relative p-6 rounded-xl border-2 transition-all duration-200 ${
                    subscription.planCode === plan.code
                      ? "border-emerald-500 shadow-lg ring-2 ring-emerald-500/20 bg-emerald-500/5"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                  }
                `}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-emerald-600 text-white text-sm font-semibold px-4 py-1 rounded-full">Most Popular</span>
                  </div>
                )}
                {plan.enterprise && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-semibold px-4 py-1 rounded-full">Enterprise</span>
                  </div>
                )}

                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{plan.name}</h3>
                <div className="mb-4">
                  {plan.enterprise ? (
                    <div className="text-center">
                      <span className="text-3xl font-bold text-gray-900 dark:text-white">Custom</span>
                      <span className="text-gray-500 dark:text-gray-400 ml-1">/month</span>
                    </div>
                  ) : (
                    <div className="flex items-baseline">
                      <span className="text-3xl font-bold text-gray-900 dark:text-white">{plan.price.toLocaleString()}</span>
                      <span className="text-gray-500 dark:text-gray-400 ml-1">/month</span>
                    </div>
                  )}
                </div>

                <ul className="space-y-2 mb-6 text-sm text-gray-600 dark:text-gray-400">
                  {AGENT_PLAN_FEATURES[plan.code]?.slice(0, 4).map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{feature}</span>
                    </li>
                  ))}
                  {AGENT_PLAN_FEATURES[plan.code]?.length > 4 && (
                    <li className="text-gray-400 dark:text-gray-500 text-center">
                      +{AGENT_PLAN_FEATURES[plan.code].length - 4} more features
                    </li>
                  )}
                </ul>

                <button
                  className={`
                    w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all duration-200 ${
                      plan.enterprise
                        ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700"
                        : subscription.planCode === plan.code
                        ? "bg-emerald-600 text-white hover:bg-emerald-700 cursor-default"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700"
                    }
                  `}
                  onClick={() => {
                    if (subscription.planCode !== plan.code && plan.code) {
                      fetchWithFirebaseAuth("/api/billing/recurring-checkout", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ planCode: plan.code }),
                      }, { action: "create-recurring-checkout", area: "billing" })
                        .then((res) => res.json())
                        .then((data) => {
                          if (data.checkoutUrl) window.location.href = data.checkoutUrl;
                        });
                    }
                  }}
                  disabled={subscription.planCode === plan.code}
                >
                  {subscription.planCode === plan.code ? "Current Plan" : plan.enterprise ? "Contact Sales" : "Upgrade"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Billing History */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#253044] p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Billing History</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-500 dark:text-gray-400">Date</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-500 dark:text-gray-400">Plan</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-500 dark:text-gray-400">Amount</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-500 dark:text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {subscription.lastPaidAt && (
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{formatDate(subscription.lastPaidAt)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {subscription.planName ? PLAN_DISPLAY_NAMES[subscription.planName] || subscription.planName : subscription.planCode}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-white">
                      {formatCurrency(subscription.priceAmount, subscription.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">
                        Paid
                      </span>
                    </td>
                  </tr>
                )}
                {!subscription.lastPaidAt && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                      No billing history yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
