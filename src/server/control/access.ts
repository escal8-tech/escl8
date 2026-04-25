import { and, desc, eq, sql } from "drizzle-orm";

import { controlDb } from "./db";
import {
  suiteEntitlements,
  suiteSubscriptionPlans,
  suiteTenantSubscriptions,
} from "./schema";
import {
  AGENT_FULL_FEATURES,
  AGENT_READONLY_FEATURES,
  RESERVATION_BLOCKED_FEATURES,
  RESERVATION_FULL_FEATURES,
  SUITE_FEATURES,
  type SuiteFeatureKey,
  type SuiteFeatureManifest,
  type SuiteLimitManifest,
  hasFeature,
  mergeFeatureManifests,
  mergeLimitManifests,
} from "./subscription-features";

export type SuiteProductModule = "agent" | "reservation";

export const SUITE_PLAN_CODES = {
  AGENT_BASIC: "AGENT_BASIC",
  AGENT_GROWTH: "AGENT_GROWTH",
  RESERVE_BASIC: "RESERVE_BASIC",
  RESERVE_PRO: "RESERVE_PRO",
  BUNDLE_CORE: "BUNDLE_CORE",
  BUNDLE_FULL: "BUNDLE_FULL",
  DEMO_FULL_ACCESS: "DEMO_FULL_ACCESS",
  PARTNER_FULL_ACCESS: "PARTNER_FULL_ACCESS",
} as const;

export type SuitePlanCode = typeof SUITE_PLAN_CODES[keyof typeof SUITE_PLAN_CODES];
export type WorkspaceMode = "full" | "readonly" | "blocked";

export interface TenantModuleAccess {
  allowed: boolean;
  workspaceMode: WorkspaceMode;
  canConnectWhatsapp: boolean;
  isGrandfathered: boolean;
  reason:
    | "subscription_active"
    | "subscription_inactive"
    | "subscription_missing"
    | "legacy_entitlement"
    | "legacy_entitlement_inactive"
    | "membership_inactive"
    | "schema_unavailable";
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  grantKind: string | null;
  lastPaidAt: Date | null;
  nextDueAt: Date | null;
  features: SuiteFeatureManifest;
  limits: SuiteLimitManifest;
}

type LatestSubscriptionRow = {
  id: string;
  status: string;
  planCode: string;
  grantKind: string;
  grantsAgent: boolean;
  grantsReservation: boolean;
  planName: string | null;
  lastPaidAt: Date | null;
  nextDueAt: Date | null;
  planFeatures: Record<string, boolean> | null;
  planLimits: SuiteLimitManifest | null;
  featureOverrides: Record<string, boolean> | null;
  limitOverrides: SuiteLimitManifest | null;
};

function isMissingRelationError(error: unknown) {
  return error instanceof Error && /does not exist|relation .* does not exist|column .* does not exist/i.test(error.message);
}

function getDefaultFeaturesForPlan(planCode: string, module: SuiteProductModule): SuiteFeatureManifest {
  switch (planCode) {
    case SUITE_PLAN_CODES.AGENT_BASIC:
      return { ...AGENT_FULL_FEATURES };
    case SUITE_PLAN_CODES.AGENT_GROWTH:
      return { ...AGENT_FULL_FEATURES, [SUITE_FEATURES.AGENT_ANALYTICS_VIEW]: true };
    case SUITE_PLAN_CODES.RESERVE_BASIC:
      return {
        ...RESERVATION_FULL_FEATURES,
        [SUITE_FEATURES.RESERVATION_INVOICE_SEND]: false,
      };
    case SUITE_PLAN_CODES.RESERVE_PRO:
      return { ...RESERVATION_FULL_FEATURES };
    case SUITE_PLAN_CODES.BUNDLE_CORE:
      return mergeFeatureManifests(AGENT_FULL_FEATURES, {
        [SUITE_FEATURES.AGENT_ANALYTICS_VIEW]: false,
      }, RESERVATION_FULL_FEATURES);
    case SUITE_PLAN_CODES.BUNDLE_FULL:
    case SUITE_PLAN_CODES.DEMO_FULL_ACCESS:
    case SUITE_PLAN_CODES.PARTNER_FULL_ACCESS:
      return mergeFeatureManifests(AGENT_FULL_FEATURES, RESERVATION_FULL_FEATURES);
    default:
      return module === "agent" ? { ...AGENT_READONLY_FEATURES } : { ...RESERVATION_BLOCKED_FEATURES };
  }
}

function getDefaultLimitsForPlan(planCode: string): SuiteLimitManifest {
  switch (planCode) {
    case SUITE_PLAN_CODES.AGENT_BASIC:
      return { "agent.messages.monthly": 1500 };
    case SUITE_PLAN_CODES.AGENT_GROWTH:
      return { "agent.messages.monthly": 5000 };
    case SUITE_PLAN_CODES.RESERVE_BASIC:
      return { "reservation.widgets.monthlyBookings": 300 };
    case SUITE_PLAN_CODES.RESERVE_PRO:
      return { "reservation.widgets.monthlyBookings": 1500 };
    case SUITE_PLAN_CODES.BUNDLE_CORE:
      return { "agent.messages.monthly": 3500, "reservation.widgets.monthlyBookings": 1000 };
    case SUITE_PLAN_CODES.BUNDLE_FULL:
    case SUITE_PLAN_CODES.DEMO_FULL_ACCESS:
    case SUITE_PLAN_CODES.PARTNER_FULL_ACCESS:
      return { "agent.messages.monthly": 20000, "reservation.widgets.monthlyBookings": 10000 };
    default:
      return {};
  }
}

function readonlyFallback(module: SuiteProductModule, reason: TenantModuleAccess["reason"]): TenantModuleAccess {
  if (module === "agent") {
    return {
      allowed: true,
      workspaceMode: "readonly",
      canConnectWhatsapp: false,
      isGrandfathered: false,
      reason,
      planCode: null,
      planName: null,
      subscriptionStatus: null,
      grantKind: null,
      lastPaidAt: null,
      nextDueAt: null,
      features: { ...AGENT_READONLY_FEATURES },
      limits: {},
    };
  }

  return {
    allowed: false,
    workspaceMode: "blocked",
    canConnectWhatsapp: false,
    isGrandfathered: false,
    reason,
    planCode: null,
    planName: null,
    subscriptionStatus: null,
    grantKind: null,
    lastPaidAt: null,
    nextDueAt: null,
    features: { ...RESERVATION_BLOCKED_FEATURES },
    limits: {},
  };
}

async function getLatestSubscriptionRow(suiteTenantId: string): Promise<LatestSubscriptionRow | null> {
  try {
    const rows = await controlDb
      .select({
        id: suiteTenantSubscriptions.id,
        status: suiteTenantSubscriptions.status,
        planCode: suiteTenantSubscriptions.planCode,
        grantKind: suiteSubscriptionPlans.grantKind,
        grantsAgent: suiteSubscriptionPlans.grantsAgent,
        grantsReservation: suiteSubscriptionPlans.grantsReservation,
        planName: suiteSubscriptionPlans.displayName,
        lastPaidAt: suiteTenantSubscriptions.lastPaidAt,
        nextDueAt: suiteTenantSubscriptions.nextDueAt,
        planFeatures: suiteSubscriptionPlans.features,
        planLimits: suiteSubscriptionPlans.limits,
        featureOverrides: suiteTenantSubscriptions.featureOverrides,
        limitOverrides: suiteTenantSubscriptions.limitOverrides,
      })
      .from(suiteTenantSubscriptions)
      .innerJoin(suiteSubscriptionPlans, eq(suiteSubscriptionPlans.code, suiteTenantSubscriptions.planCode))
      .where(eq(suiteTenantSubscriptions.suiteTenantId, suiteTenantId))
      .orderBy(
        desc(
          sql`case
            when ${suiteTenantSubscriptions.status} = 'active' then 5
            when ${suiteSubscriptionPlans.grantKind} in ('partner', 'demo') then 4
            when ${suiteTenantSubscriptions.status} = 'past_due' then 3
            when ${suiteTenantSubscriptions.status} = 'pending_setup' then 2
            else 1
          end`,
        ),
        desc(suiteTenantSubscriptions.updatedAt),
      )
      .limit(1);

    return (rows[0] as LatestSubscriptionRow | undefined) ?? null;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }
}

async function hasAnySubscriptionRows(suiteTenantId: string) {
  try {
    const rows = await controlDb
      .select({ count: sql<number>`count(*)::int` })
      .from(suiteTenantSubscriptions)
      .where(eq(suiteTenantSubscriptions.suiteTenantId, suiteTenantId));
    return (rows[0]?.count ?? 0) > 0;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return false;
    }
    throw error;
  }
}

function normalizeSubscriptionAccess(latestSubscription: LatestSubscriptionRow, module: SuiteProductModule): TenantModuleAccess {
  const grantKind = String(latestSubscription.grantKind || "standard");
  const isSpecialAlwaysOn = grantKind === "partner" || grantKind === "demo";
  const isActive = String(latestSubscription.status || "").toLowerCase() === "active";
  const moduleGranted = module === "agent" ? latestSubscription.grantsAgent : latestSubscription.grantsReservation;
  const fullAccess = moduleGranted && (isSpecialAlwaysOn || isActive);
  const features = mergeFeatureManifests(
    getDefaultFeaturesForPlan(latestSubscription.planCode, module),
    latestSubscription.planFeatures ?? {},
    latestSubscription.featureOverrides ?? {},
  );
  const limits = mergeLimitManifests(
    getDefaultLimitsForPlan(latestSubscription.planCode),
    latestSubscription.planLimits ?? {},
    latestSubscription.limitOverrides ?? {},
  );

  if (module === "agent" && !fullAccess) {
    return {
      allowed: true,
      workspaceMode: "readonly",
      canConnectWhatsapp: false,
      isGrandfathered: false,
      reason: "subscription_inactive",
      planCode: latestSubscription.planCode,
      planName: latestSubscription.planName,
      subscriptionStatus: latestSubscription.status,
      grantKind: latestSubscription.grantKind,
      lastPaidAt: latestSubscription.lastPaidAt ?? null,
      nextDueAt: latestSubscription.nextDueAt ?? null,
      features: mergeFeatureManifests(AGENT_READONLY_FEATURES, features),
      limits,
    };
  }

  return {
    allowed: fullAccess,
    workspaceMode: fullAccess ? "full" : "blocked",
    canConnectWhatsapp: Boolean(fullAccess && hasFeature(features, SUITE_FEATURES.AGENT_WHATSAPP_CONNECT)),
    isGrandfathered: false,
    reason: fullAccess ? "subscription_active" : "subscription_inactive",
    planCode: latestSubscription.planCode,
    planName: latestSubscription.planName,
    subscriptionStatus: latestSubscription.status,
    grantKind: latestSubscription.grantKind,
    lastPaidAt: latestSubscription.lastPaidAt ?? null,
    nextDueAt: latestSubscription.nextDueAt ?? null,
    features,
    limits,
  };
}

export async function getTenantModuleAccess(
  suiteTenantId: string,
  module: SuiteProductModule,
): Promise<TenantModuleAccess> {
  const latestSubscription = await getLatestSubscriptionRow(suiteTenantId);
  const hasSubscriptionRows = latestSubscription ? true : await hasAnySubscriptionRows(suiteTenantId);

  if (latestSubscription) {
    return normalizeSubscriptionAccess(latestSubscription, module);
  }

  let entitlement: { status: string | null } | null = null;
  try {
    entitlement = await controlDb
      .select()
      .from(suiteEntitlements)
      .where(and(eq(suiteEntitlements.suiteTenantId, suiteTenantId), eq(suiteEntitlements.module, module)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        ...readonlyFallback(module, "schema_unavailable"),
        allowed: true,
        workspaceMode: "full",
        canConnectWhatsapp: module === "agent",
        features: module === "agent" ? { ...AGENT_FULL_FEATURES } : { ...RESERVATION_FULL_FEATURES },
      };
    }
    throw error;
  }

  if (entitlement && ["active", "trial"].includes(String(entitlement.status))) {
    return {
      allowed: true,
      workspaceMode: "full",
      canConnectWhatsapp: module === "agent",
      isGrandfathered: !hasSubscriptionRows,
      reason: "legacy_entitlement",
      planCode: null,
      planName: null,
      subscriptionStatus: entitlement.status,
      grantKind: null,
      lastPaidAt: null,
      nextDueAt: null,
      features: module === "agent" ? { ...AGENT_FULL_FEATURES } : { ...RESERVATION_FULL_FEATURES },
      limits: {},
    };
  }

  return readonlyFallback(module, entitlement ? "legacy_entitlement_inactive" : "subscription_missing");
}

export function tenantHasFeature(access: TenantModuleAccess | null | undefined, featureKey: SuiteFeatureKey) {
  return hasFeature(access?.features, featureKey);
}
