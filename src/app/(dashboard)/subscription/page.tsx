"use client";

import { Suspense } from "react";
import { SubscriptionContent } from "@/components/subscription/SubscriptionContent";

export default function SubscriptionPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white dark:bg-[#1A2332] flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent"></div>
        </div>
      }
    >
      <SubscriptionContent />
    </Suspense>
  );
}