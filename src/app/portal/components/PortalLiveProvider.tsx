"use client";

import { useLivePortalEventsInternal } from "@/app/portal/hooks/useLivePortalEvents";

export function PortalLiveProvider() {
  useLivePortalEventsInternal();
  return null;
}
