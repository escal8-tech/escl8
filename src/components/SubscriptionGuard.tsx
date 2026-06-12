"use client";

import { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useHasValidSubscription, useModuleAccess } from "@/hooks/useSubscriptionFeatures";
import { useAuthSubscription } from "@/contexts/AuthSubscriptionContext";

interface SubscriptionGuardProps {
  children: ReactNode;
  /** Required module access: 'agent', 'reservation', or both */
  requiredModule?: "agent" | "reservation" | "both";
  /** Fallback path if access denied */
  fallbackPath?: string;
  /** Show loading state while checking */
  showLoading?: boolean;
}

export function SubscriptionGuard({
  children,
  requiredModule = "agent",
  fallbackPath = "/subscription",
  showLoading = true,
}: SubscriptionGuardProps) {
  const router = useRouter();
  const hasValidSubscription = useHasValidSubscription();
  const agentAccess = useModuleAccess("agent");
  const reservationAccess = useModuleAccess("reservation");
  const moduleAccess = requiredModule === "both"
    ? agentAccess && reservationAccess
    : requiredModule === "agent" ? agentAccess : reservationAccess;
  const { subscription } = useAuthSubscription();

  const isLoading = subscription === null; // null means not loaded yet
  const hasAccess = hasValidSubscription && moduleAccess;

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      router.replace(fallbackPath);
    }
  }, [isLoading, hasAccess, router, fallbackPath]);

  if (isLoading && showLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 bg-emerald-600 rounded-full animate-pulse mx-auto mb-4"></div>
          <p className="text-gray-400">Verifying subscription...</p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return null; // Will redirect via useEffect
  }

  return <>{children}</>;
}

/**
 * Wrapper for pages that require specific features
 */
interface FeatureGuardProps {
  children: ReactNode;
  requiredFeatures: string[]; // SuiteFeatureKey[]
  fallbackPath?: string;
  requireAll?: boolean;
}

export function FeatureGuard({
  children,
  requiredFeatures,
  fallbackPath = "/subscription",
  requireAll = true,
}: FeatureGuardProps) {
  const router = useRouter();
  const { subscription } = useAuthSubscription();

  const hasFeatures = useMemo(() => {
    if (!subscription?.features) return false;
    if (requireAll) {
      return requiredFeatures.every((key) => subscription.features[key] === true);
    }
    return requiredFeatures.some((key) => subscription.features[key] === true);
  }, [subscription, requiredFeatures, requireAll]);

  const isLoading = subscription === null;

  useEffect(() => {
    if (!isLoading && !hasFeatures) {
      router.replace(fallbackPath);
    }
  }, [isLoading, hasFeatures, router, fallbackPath]);

  if (isLoading && requiredFeatures.length > 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 bg-emerald-600 rounded-full animate-pulse mx-auto mb-4"></div>
          <p className="text-gray-400">Checking feature access...</p>
        </div>
      </div>
    );
  }

  if (!hasFeatures) {
    return null;
  }

  return <>{children}</>;
}

import { useMemo } from "react";
