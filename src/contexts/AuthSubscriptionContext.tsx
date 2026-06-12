"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface CachedSubscription {
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
  limits: Record<string, number>;
  isActive: boolean;
  isSpecialGrant: boolean;
}

interface AuthSubscriptionContextValue {
  subscription: CachedSubscription | null;
  setSubscription: (sub: CachedSubscription | null) => void;
}

const AuthSubscriptionContext = createContext<AuthSubscriptionContextValue | null>(null);

export function AuthSubscriptionProvider({ children }: { children: ReactNode }) {
  const [subscription, setSubscription] = useState<CachedSubscription | null>(null);

  return (
    <AuthSubscriptionContext.Provider value={{ subscription, setSubscription }}>
      {children}
    </AuthSubscriptionContext.Provider>
  );
}

export function useAuthSubscription() {
  const context = useContext(AuthSubscriptionContext);
  if (!context) {
    throw new Error("useAuthSubscription must be used within AuthSubscriptionProvider");
  }
  return context;
}