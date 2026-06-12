"use client";

import { useAuthSubscription } from "@/contexts/AuthSubscriptionContext";
import {
  SUITE_FEATURES,
  hasFeature,
  type SuiteFeatureKey,
} from "@/server/control/subscription-features";

/**
 * Hook to check if current subscription has a specific feature
 * Uses cached subscription from auth status (loaded once at login)
 */
export function useSubscriptionFeature(featureKey: SuiteFeatureKey): boolean {
  const { subscription } = useAuthSubscription();

  return hasFeature(subscription?.features, featureKey);
}

/**
 * Hook to check if current subscription has any of the given features
 */
export function useSubscriptionAnyFeature(featureKeys: SuiteFeatureKey[]): boolean {
  const { subscription } = useAuthSubscription();

  return featureKeys.some((key) => hasFeature(subscription?.features, key));
}

/**
 * Hook to check if current subscription has all of the given features
 */
export function useSubscriptionAllFeatures(featureKeys: SuiteFeatureKey[]): boolean {
  const { subscription } = useAuthSubscription();

  return featureKeys.every((key) => hasFeature(subscription?.features, key));
}

/**
 * Hook to get the current subscription's workspace mode
 * 'full' = full access, 'readonly' = read-only, 'blocked' = no access
 */
export function useWorkspaceMode(): "full" | "readonly" | "blocked" {
  const { subscription } = useAuthSubscription();

  if (!subscription?.isActive || !subscription.hasSubscription) return "blocked";
  return subscription.isSpecialGrant || subscription.status === "active" ? "full" : "readonly";
}

/**
 * Hook to get subscription limits
 */
export function useSubscriptionLimits(): Record<string, number> {
  const { subscription } = useAuthSubscription();

  return subscription?.limits || {};
}

/**
 * Hook to check if user can access a specific module
 */
export function useModuleAccess(module: "agent" | "reservation"): boolean {
  const { subscription } = useAuthSubscription();

  if (!subscription?.isActive || !subscription.hasSubscription) return false;
  if (module === "agent") {
    return subscription.features?.[SUITE_FEATURES.AGENT_PORTAL_VIEW] === true || subscription.isSpecialGrant;
  }
  return subscription.features?.[SUITE_FEATURES.RESERVATION_WORKSPACE] === true || subscription.isSpecialGrant;
}

/**
 * Hook to get current plan info
 */
export function useCurrentPlan() {
  const { subscription } = useAuthSubscription();

  if (!subscription?.hasSubscription) return null;

    const displayNames: Record<string, string> = {
      RESERVE_BASIC: "Starter",
      RESERVE_PRO: "Professional",
      AGENT_BASIC: "Agent Basic",
      AGENT_GROWTH: "Agent Growth",
      AGENT_ENTERPRISE: "Agent Enterprise",
      BUNDLE_CORE: "Pro Bundle",
      BUNDLE_FULL: "Full Bundle",
      DEMO_FULL_ACCESS: "Demo Access",
      PARTNER_FULL_ACCESS: "Partner Access",
    };

  return {
      planCode: subscription.planCode,
      planName: subscription.planName ? displayNames[subscription.planName] || subscription.planName : "Custom Plan",
      status: subscription.status,
      grantKind: subscription.grantKind,
      isActive: subscription.isActive,
      isSpecialGrant: subscription.isSpecialGrant,
      monthlyCredits: subscription.monthlyCredits,
      creditsUsed: subscription.creditsUsed,
      creditsBalance: subscription.creditsBalance,
      priceAmount: subscription.priceAmount,
      currency: subscription.currency,
      nextDueAt: subscription.nextDueAt,
      lastPaidAt: subscription.lastPaidAt,
  };
}

/**
 * Check if subscription is in a valid state (active or special grant)
 */
export function useHasValidSubscription(): boolean {
  const { subscription } = useAuthSubscription();

  return subscription?.isActive === true && subscription?.hasSubscription === true;
}
