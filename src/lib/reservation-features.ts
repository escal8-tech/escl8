import "server-only";

/**
 * Reservation App Feature Gating
 * Checks tenant subscription features from control DB
 */

export interface ReservationFeatures {
  tier: string;
  maxResources: number;
  maxLocations: number;
  staffManagement: boolean;
  packagesEnabled: boolean;
  eventsEnabled: boolean;
  floorPlanAccess: boolean;
  stripeIntegration: boolean;
  senangpayIntegration: boolean;
  whatsappBotIntegration: boolean;
  customDomain: boolean;
  apiAccess: boolean;
  monthlyCredits: number;
  staffScheduling: boolean;
  floorPlanEditor: boolean;
  eventCreation: boolean;
}

export const RESERVATION_TIER_FEATURES: Record<string, ReservationFeatures> = {
  starter: {
    tier: "starter",
    maxResources: 1,
    maxLocations: 1,
    staffManagement: false,
    packagesEnabled: true,
    eventsEnabled: false,
    floorPlanAccess: false,
    stripeIntegration: false,
    senangpayIntegration: true,
    whatsappBotIntegration: false,
    customDomain: false,
    apiAccess: false,
    monthlyCredits: 5000,
    staffScheduling: false,
    floorPlanEditor: false,
    eventCreation: false,
  },
  professional: {
    tier: "professional",
    maxResources: 5,
    maxLocations: 2,
    staffManagement: true,
    packagesEnabled: true,
    eventsEnabled: true,
    floorPlanAccess: true,
    stripeIntegration: true,
    senangpayIntegration: true,
    whatsappBotIntegration: false,
    customDomain: true,
    apiAccess: true,
    monthlyCredits: 25000,
    staffScheduling: true,
    floorPlanEditor: true,
    eventCreation: true,
  },
  business: {
    tier: "business",
    maxResources: 999,
    maxLocations: 10,
    staffManagement: true,
    packagesEnabled: true,
    eventsEnabled: true,
    floorPlanAccess: true,
    stripeIntegration: true,
    senangpayIntegration: true,
    whatsappBotIntegration: true,
    customDomain: true,
    apiAccess: true,
    monthlyCredits: 50000,
    staffScheduling: true,
    floorPlanEditor: true,
    eventCreation: true,
  },
  enterprise: {
    tier: "enterprise",
    maxResources: 999,
    maxLocations: 999,
    staffManagement: true,
    packagesEnabled: true,
    eventsEnabled: true,
    floorPlanAccess: true,
    stripeIntegration: true,
    senangpayIntegration: true,
    whatsappBotIntegration: true,
    customDomain: true,
    apiAccess: true,
    monthlyCredits: 999999,
    staffScheduling: true,
    floorPlanEditor: true,
    eventCreation: true,
  },
  partner: {
    tier: "partner",
    maxResources: 999,
    maxLocations: 999,
    staffManagement: true,
    packagesEnabled: true,
    eventsEnabled: true,
    floorPlanAccess: true,
    stripeIntegration: true,
    senangpayIntegration: true,
    whatsappBotIntegration: true,
    customDomain: true,
    apiAccess: true,
    monthlyCredits: 999999,
    staffScheduling: true,
    floorPlanEditor: true,
    eventCreation: true,
  },
};

export function getReservationTier(tier: string): ReservationFeatures {
  return RESERVATION_TIER_FEATURES[tier] || RESERVATION_TIER_FEATURES.starter;
}

export function hasReservationFeature(tier: string, feature: keyof ReservationFeatures): boolean {
  const features = getReservationTier(tier);
  return Boolean(features[feature]);
}

export function getReservationLimit(tier: string, feature: keyof ReservationFeatures): number {
  const features = getReservationTier(tier);
  const value = features[feature];
  return typeof value === "number" ? value : 0;
}

export function checkReservationAccess(tier: string, requiredFeatures: (keyof ReservationFeatures)[]): { allowed: boolean; missing: string[] } {
  const features = getReservationTier(tier);
  const missing: string[] = [];
  
  for (const feature of requiredFeatures) {
    if (!features[feature]) {
      missing.push(feature);
    }
  }
  
  return {
    allowed: missing.length === 0,
    missing,
  };
}

/**
 * Get reservation features for a business (from business record)
 */
export function getBusinessReservationFeatures(business: { messageUsageTier: string }): ReservationFeatures {
  return getReservationTier(business.messageUsageTier || "standard");
}

/**
 * Middleware helper for checking feature access in API routes
 */
export function requireReservationFeatures(...requiredFeatures: (keyof ReservationFeatures)[]) {
  return (tier: string) => {
    const features = getReservationTier(tier);
    const missing = requiredFeatures.filter(f => !features[f]);
    
    if (missing.length > 0) {
      return { allowed: false, missing };
    }
    
    return { allowed: true, missing: [] };
  };
}