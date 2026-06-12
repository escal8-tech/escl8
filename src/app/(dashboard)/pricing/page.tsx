"use client";

import { useState } from "react";
import { Check, X, Sparkles, Crown, Zap, Shield, Globe, Users, Calendar, Bed, Utensils, Building, Users as UsersIcon, Crown as CrownIcon, MessageSquare, Cpu, Database, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Tier {
  id: string;
  name: string;
  price: number;
  currency: string;
  period: string;
  description: string;
  features: string[];
  highlighted: boolean;
  ctaText: string;
  popular?: boolean;
  enterprise?: boolean;
  monthlyCredits: number;
  maxWhatsAppNumbers: number;
  maxTeamMembers: number;
  aiEnabled: boolean;
  analytics: boolean;
  webhooks: boolean;
  customDomain: boolean;
  apiAccess: boolean;
  prioritySupport: boolean;
}

const tiers: Tier[] = [
  {
    id: "standard",
    name: "Standard",
    price: 250,
    currency: "MYR",
    period: "/month",
    description: "Perfect for small businesses getting started with WhatsApp automation",
    features: [
      "1 WhatsApp Business number",
      "Up to 3 team members",
      "10 concurrent conversations",
      "Basic message templates",
      "SenangPay integration",
      "10,000 credits/month",
      "Email support",
    ],
    highlighted: false,
    ctaText: "Start Free Trial",
    monthlyCredits: 10000,
    maxWhatsAppNumbers: 1,
    maxTeamMembers: 3,
    aiEnabled: false,
    analytics: false,
    webhooks: false,
    customDomain: false,
    apiAccess: false,
    prioritySupport: false,
  },
  {
    id: "agent",
    name: "Agent Pro",
    price: 400,
    currency: "MYR",
    period: "/month",
    description: "For growing teams needing AI-powered customer conversations",
    features: [
      "Up to 3 WhatsApp Business numbers",
      "Up to 10 team members",
      "100 concurrent conversations",
      "AI-powered responses with custom prompts",
      "Advanced analytics dashboard",
      "Webhook integrations",
      "50,000 credits/month",
      "Priority email support",
      "API access",
    ],
    highlighted: true,
    ctaText: "Get Started",
    popular: true,
    monthlyCredits: 50000,
    maxWhatsAppNumbers: 3,
    maxTeamMembers: 10,
    aiEnabled: true,
    analytics: true,
    webhooks: true,
    customDomain: false,
    apiAccess: true,
    prioritySupport: true,
  },
  {
    id: "pro_bundle",
    name: "Pro Bundle",
    price: 550,
    currency: "MYR",
    period: "/month",
    description: "Complete solution: Agent + Reservation for full business automation",
    features: [
      "Everything in Agent Pro",
      "Full Reservation system access",
      "Unlimited resources & staff",
      "Floor plan management",
      "Events & ticketing",
      "Staff management & scheduling",
      "Stripe + SenangPay payments",
      "Custom domain & branding",
      "API access",
      "60,000 credits/month",
      "Priority support with dedicated manager",
    ],
    highlighted: true,
    ctaText: "Contact Sales",
    monthlyCredits: 60000,
    maxWhatsAppNumbers: 3,
    maxTeamMembers: 10,
    aiEnabled: true,
    analytics: true,
    webhooks: true,
    customDomain: true,
    apiAccess: true,
    prioritySupport: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 0,
    currency: "MYR",
    period: "/month",
    description: "Custom solutions for large organizations with dedicated support",
    features: [
      "Unlimited WhatsApp numbers",
      "Unlimited team members",
      "Unlimited concurrent conversations",
      "Custom AI model training",
      "Advanced analytics & reporting",
      "Custom webhook integrations",
      "White-label solution",
      "Dedicated account manager",
      "SLA guarantee",
      "On-premise deployment option",
      "Custom contract & billing",
      "Dedicated infrastructure",
    ],
    highlighted: true,
    ctaText: "Contact Sales",
    enterprise: true,
    monthlyCredits: 999999,
    maxWhatsAppNumbers: 999,
    maxTeamMembers: 999,
    aiEnabled: true,
    analytics: true,
    webhooks: true,
    customDomain: true,
    apiAccess: true,
    prioritySupport: true,
  },
];

export function PricingPage() {
  const [selectedTier, setSelectedTier] = useState<string>("agent");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
      minimumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-16 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
            <span className="flex items-center gap-1">
              <Sparkles className="w-4 h-4" />
              Agent Platform
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
            Choose the plan that fits your business. All plans include SenangPay integration
            and a 14-day free trial. No credit card required.
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center p-1 bg-white rounded-lg shadow-sm border border-gray-200">
            {["monthly", "yearly"].map((cycle) => (
              <button
                key={cycle}
                onClick={() => setBillingCycle(cycle as "monthly" | "yearly")}
                className={cn(
                  "px-6 py-2 rounded-md text-sm font-medium transition-colors",
                  billingCycle === cycle
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                )}
              >
                {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                {billingCycle === "yearly" && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Save 20%</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Tier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              selected={selectedTier === tier.id}
              onSelect={() => setSelectedTier(tier.id)}
              billingCycle={billingCycle}
            />
          ))}
        </div>

        {/* Feature Comparison */}
        <div className="mt-20">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Feature Comparison
          </h2>
          <FeatureComparisonTable tiers={tiers} />
        </div>

        {/* FAQ */}
        <div className="mt-20">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Frequently Asked Questions
          </h2>
          <FAQSection />
        </div>

        {/* CTA */}
        <div className="mt-20 text-center">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-12 md:p-16 text-white">
            <h3 className="text-3xl md:text-4xl font-bold mb-4">
              Ready to transform your customer communication?
            </h3>
            <p className="text-lg text-blue-100 mb-8 max-w-2xl mx-auto">
              Join hundreds of businesses using Escal8 to automate conversations,
              increase conversions, and delight customers.
            </p>
            <button className="bg-white text-blue-600 px-8 py-4 rounded-lg font-semibold text-lg hover:bg-gray-100 transition-colors">
              Start Free Trial
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TierCard({
  tier,
  selected,
  onSelect,
  billingCycle,
}: {
  tier: Tier;
  selected: boolean;
  onSelect: () => void;
  billingCycle: "monthly" | "yearly";
}) {
  const price = billingCycle === "yearly"
    ? Math.round(tier.price * 12 * 0.8)
    : tier.price;

  return (
    <div
      className={cn(
        "relative p-8 bg-white rounded-2xl shadow-sm border-2 transition-all duration-200",
        selected
          ? "border-blue-500 shadow-lg ring-2 ring-blue-500/20"
          : "border-gray-200 hover:border-gray-300"
      )}
      onClick={onSelect}
    >
      {tier.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-blue-600 text-white text-sm font-semibold px-4 py-1 rounded-full">
            Most Popular
          </span>
        </div>
      )}

      {tier.enterprise && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-semibold px-4 py-1 rounded-full">
            Enterprise
          </span>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-xl font-bold text-gray-900 mb-2">{tier.name}</h3>
        <p className="text-gray-600 text-sm mb-6">{tier.description}</p>

        <div className="mb-6">
          {tier.enterprise ? (
            <div className="text-center">
              <span className="text-4xl font-bold text-gray-900">Custom</span>
              <span className="text-gray-500 ml-1">/month</span>
            </div>
          ) : (
            <div className="flex items-baseline">
              <span className="text-4xl font-bold text-gray-900">{price.toLocaleString()}</span>
              <span className="text-gray-500 ml-1">/month</span>
            </div>
          )}
          {billingCycle === "yearly" && !tier.enterprise && (
            <p className="text-sm text-green-600 mt-1">
              Billed yearly: {tier.price * 12 * 0.8} MYR/year (Save 20%)
            </p>
          )}
        </div>
      </div>

      <ul className="space-y-3 mb-8">
        {tier.features.map((feature, index) => (
          <li key={index} className="flex items-start gap-3 text-gray-700">
            <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{feature}</span>
          </li>
        ))}
      </ul>

      <button
        className={cn(
          "w-full py-3 px-6 rounded-xl font-semibold text-sm transition-all duration-200",
          tier.enterprise
            ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700"
            : selected
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-gray-100 text-gray-900 hover:bg-gray-200"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        {tier.ctaText}
      </button>
    </div>
  );
}

function FeatureComparisonTable({ tiers }: { tiers: Tier[] }) {
  const features: Array<{ key: keyof Tier; label: string; type?: "number" }> = [
    { key: "maxWhatsAppNumbers", label: "WhatsApp Numbers", type: "number" as const },
    { key: "maxTeamMembers", label: "Team Members", type: "number" as const },
    { key: "aiEnabled", label: "AI-Powered Responses" },
    { key: "analytics", label: "Analytics Dashboard" },
    { key: "webhooks", label: "Webhook Integrations" },
    { key: "customDomain", label: "Custom Domain" },
    { key: "apiAccess", label: "API Access" },
    { key: "prioritySupport", label: "Priority Support" },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Feature</th>
            {tiers.map((tier) => (
              <th key={tier.id} className="px-6 py-4 text-center">
                <div className="font-semibold text-gray-900">{tier.name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {features.map((feature) => (
            <tr key={feature.key} className="hover:bg-gray-50">
              <td className="px-6 py-4 text-sm font-medium text-gray-900">{feature.label}</td>
              {tiers.map((tier) => {
                const value = tier[feature.key];
                return (
                  <td key={tier.id} className="px-6 py-4 text-center">
                    {typeof value === "boolean" ? (
                      value ? (
                        <Check className="w-5 h-5 text-emerald-500 mx-auto" />
                      ) : (
                        <X className="w-5 h-5 text-gray-300 mx-auto" />
                      )
                    ) : (
                      <span className="text-sm text-gray-700 font-medium">
                        {typeof value === "number" && value > 100 ? "Unlimited" : value}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FAQSection() {
  const faqs = [
    {
      q: "Can I change plans later?",
      a: "Yes, you can upgrade or downgrade at any time. Changes take effect immediately, and billing is prorated.",
    },
    {
      q: "What happens if I exceed my credit limit?",
      a: "You can purchase additional credit packs at any time. We'll notify you at 80% and 100% usage.",
    },
    {
      q: "Is there a setup fee?",
      a: "No setup fees on any plan. You only pay the monthly subscription.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes, cancel anytime. You'll retain access until the end of your billing period.",
    },
    {
      q: "Do you offer discounts for non-profits?",
      a: "Yes! We offer 50% discount for registered non-profits and educational institutions.",
    },
    {
      q: "What payment methods do you accept?",
      a: "We accept all major credit cards via Stripe and local payments via SenangPay (FPX, credit/debit cards, e-wallets).",
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {faqs.map((faq, index) => (
        <details key={index} className="group bg-white border border-gray-200 rounded-xl overflow-hidden">
          <summary className="flex items-center justify-between p-6 cursor-pointer">
            <h3 className="text-lg font-semibold text-gray-900">{faq.q}</h3>
            <svg className="w-5 h-5 text-gray-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="px-6 pb-6 text-gray-600">
            <p>{faq.a}</p>
          </div>
        </details>
      ))}
    </div>
  );
}

// Export for Next.js
export default PricingPage;
