import { NextResponse, type NextRequest } from 'next/server';
import { getSuiteTenantIdFromRequest } from './auth-session';
import { getTenantModuleAccess, tenantHasFeature, type TenantModuleAccess, type SuiteFeatureKey, type SuiteProductModule } from '@/server/control/access';

export interface SubscriptionGuardConfig {
  requiredModule?: SuiteProductModule;
  requiredFeatures?: SuiteFeatureKey[];
  fallbackPath?: string;
}

export interface AuthenticatedRequest extends NextRequest {
  suiteTenantId?: string;
  tenantAccess?: TenantModuleAccess;
}

/**
 * Server-side subscription middleware for App Router
 * Checks subscription status and features BEFORE rendering page or executing API route
 */
export async function withSubscriptionGuard(
  request: NextRequest,
  config: SubscriptionGuardConfig = {}
): Promise<{ allowed: boolean; redirect?: NextResponse; tenantAccess?: TenantModuleAccess }> {
  const {
    requiredModule = 'agent',
    requiredFeatures = [],
    fallbackPath = '/subscription'
  } = config;

  // Get tenant ID from Authorization header (server-side only)
  const suiteTenantId = await getSuiteTenantIdFromRequest(request);
  
  if (!suiteTenantId) {
    return {
      allowed: false,
      redirect: NextResponse.redirect(new URL(`${fallbackPath}?reason=not_authenticated`, request.url))
    };
  }

  // Fetch access from control DB
  const tenantAccess = await getTenantModuleAccess(suiteTenantId, requiredModule);
  
  // Attach to request for downstream use
  (request as AuthenticatedRequest).suiteTenantId = suiteTenantId;
  (request as AuthenticatedRequest).tenantAccess = tenantAccess;

  // Check module-level access
  if (!tenantAccess.allowed) {
    return {
      allowed: false,
      redirect: NextResponse.redirect(new URL(`${fallbackPath}?reason=inactive_subscription&module=${requiredModule}`, request.url)),
      tenantAccess
    };
  }

  // Check feature-level access
  for (const feature of requiredFeatures) {
    if (!tenantHasFeature(tenantAccess, feature)) {
      return {
        allowed: false,
        redirect: NextResponse.redirect(new URL(`${fallbackPath}?reason=feature_locked&feature=${feature}`, request.url)),
        tenantAccess
      };
    }
  }

  return { allowed: true, tenantAccess };
}

/**
 * Server-side helper to get subscription-aware request context
 */
export async function getSubscriptionContext(request: NextRequest): Promise<{
  suiteTenantId: string;
  tenantAccess: TenantModuleAccess;
} | null> {
  const suiteTenantId = await getSuiteTenantIdFromRequest(request);
  if (!suiteTenantId) return null;
  
  const tenantAccess = await getTenantModuleAccess(suiteTenantId, 'agent');
  return { suiteTenantId, tenantAccess };
}

/**
 * Middleware wrapper for API routes
 */
export function createSubscriptionMiddleware(config: SubscriptionGuardConfig) {
  return async (request: NextRequest) => {
    const result = await withSubscriptionGuard(request, config);
    
    if (!result.allowed && result.redirect) {
      return result.redirect;
    }
    
    return NextResponse.next();
  };
}

/**
 * Check specific feature access from request context
 */
export function checkFeatureAccess(
  request: NextRequest,
  feature: SuiteFeatureKey
): { allowed: boolean; tenantAccess: TenantModuleAccess } | null {
  const authReq = request as AuthenticatedRequest;
  if (!authReq.tenantAccess) return null;
  
  return {
    allowed: tenantHasFeature(authReq.tenantAccess, feature),
    tenantAccess: authReq.tenantAccess
  };
}

/**
 * Check limit from request context
 */
export function checkLimit(
  request: NextRequest,
  limitKey: string
): number | null {
  const authReq = request as AuthenticatedRequest;
  if (!authReq.tenantAccess) return null;
  const value = authReq.tenantAccess.limits[limitKey];
  return typeof value === 'number' ? value : null;
}

/**
 * Get tenant access from request (set by middleware)
 */
export function getTenantAccess(request: NextRequest): TenantModuleAccess | undefined {
  return (request as AuthenticatedRequest).tenantAccess;
}

/**
 * Get suiteTenantId from request (set by middleware)
 */
export function getSuiteTenantId(request: NextRequest): string | undefined {
  return (request as AuthenticatedRequest).suiteTenantId;
}