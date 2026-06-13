"use client";

import { useMemo } from "react";
import { trpc } from "@/utils/trpc";

export function useScopedVenue() {
  const businessQuery = trpc.business.getMine.useQuery(
    undefined,
    { staleTime: 30000, refetchOnWindowFocus: false }
  );

  const business = businessQuery.data;

  return {
    businessId: business?.id ?? null,
    businessQuery,
    business,
  };
}
