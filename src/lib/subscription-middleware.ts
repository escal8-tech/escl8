import { NextResponse, type NextRequest } from 'next/server';
import { getSuiteTenantIdFromRequest } from './auth-session';
import { verifyAccessToken } from './jwt-auth';
import { getTenantModuleAccess, tenantHasFeature, type TenantModuleAccess, type SuiteFeatureKey, type SuiteProductModule } from '@/server/control/access';

export interface SubscriptionGuardConfig {
  requiredModule?: SuiteProductModule;
  requiredFeatures?: SuiteFeatureKey[];
  fallbackPath?: string;
}

/**
 * @deprecated Mutating the NextRequest does not propagate to route handlers in
 * the App Router (route handlers receive a different request instance). The
 * subscription middleware now forwards context via internal request headers
 * (see SUBSCRIPTION_TENANT_HEADER / SUBSCRIPTION_ACCESS_HEADER). The accessor
 * functions below read from those headers and only return a value when invoked
 * downstream of the middleware that set them.
 */
export interface AuthenticatedRequest extends NextRequest {
  suiteTenantId?: string;
  tenantAccess?: TenantModuleAccess;
}

// Internal headers used to forward middleware-resolved context to route handlers.
// Set via NextResponse.next({ request: { headers } }) so Next.js makes them
// visible on the route handler's incoming request.
export const SUBSCRIPTION_TENANT_HEADER = 'x-internal-suite-tenant-id';
export const SUBSCRIPTION_ACCESS_HEADER = 'x-internal-tenant-access';

const COOKIE_ACCESS_TOKEN = 'escal8_access_token';

/**
 * Resolve subscription context from either an httpOnly access-token cookie
 * (used by browser navigation) or an Authorization: Bearer Firebase ID token
 * (used by server-to-server / API calls). Cookies take precedence.
 */
export async function getSubscriptionContext(
  request: NextRequest,
  module: SuiteProductModule = 'agent'
): Promise<{
  suiteTenantId: string;
  tenantAccess: TenantModuleAccess;
} | null> {
  // Prefer the Escal8 access-token cookie (browser navigation case)
  const accessToken = request.cookies.get(COOKIE_ACCESS_TOKEN)?.value;
  if (accessToken) {
    const payload = await verifyAccessToken(accessToken);
    if (payload?.suiteTenantId) {
      const tenantAccess = await getTenantModuleAccess(payload.suiteTenantId, module);
      return { suiteTenantId: payload.suiteTenantId, tenantAccess };
    }
  }

  // Fallback: Authorization: Bearer <firebaseIdToken> (server-to-server)
  const suiteTenantId = await getSuiteTenantIdFromRequest(request);
  if (!suiteTenantId) return null;

  const tenantAccess = await getTenantModuleAccess(suiteTenantId, module);
  return { suiteTenantId, tenantAccess };
}

/**
 * Server-side subscription middleware for App Router.
 * Resolves subscription context, returns a redirect when the caller is not
 * permitted, and otherwise returns a NextResponse.next() that forwards the
 * resolved tenantId/access to downstream route handlers via internal headers.
 */
export async function withSubscriptionGuard(
  request: NextRequest,
  config: SubscriptionGuardConfig = {}
): Promise<{ allowed: boolean; redirect?: NextResponse; response?: NextResponse; tenantAccess?: TenantModuleAccess; suiteTenantId?: string }> {
  const {
    requiredModule = 'agent',
    requiredFeatures = [],
    fallbackPath = '/subscription'
  } = config;

  const context = await getSubscriptionContext(request, requiredModule);

  if (!context) {
    return {
      allowed: false,
      redirect: NextResponse.redirect(new URL(`${fallbackPath}?reason=not_authenticated`, request.url))
    };
  }

  const { suiteTenantId, tenantAccess } = context;

  // Check module-level access
  if (!tenantAccess.allowed) {
    return {
      allowed: false,
      redirect: NextResponse.redirect(new URL(`${fallbackPath}?reason=inactive_subscription&module=${requiredModule}`, request.url)),
      tenantAccess,
      suiteTenantId
    };
  }

  // Check feature-level access
  for (const feature of requiredFeatures) {
    if (!tenantHasFeature(tenantAccess, feature)) {
      return {
        allowed: false,
        redirect: NextResponse.redirect(new URL(`${fallbackPath}?reason=feature_locked&feature=${feature}`, request.url)),
        tenantAccess,
        suiteTenantId
      };
    }
  }

  // Forward context to route handlers via request headers (App Router requires
  // request.headers propagation, not request mutation).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(SUBSCRIPTION_TENANT_HEADER, suiteTenantId);
  try {
    requestHeaders.set(SUBSCRIPTION_ACCESS_HEADER, JSON.stringify(tenantAccess));
  } catch {
    // Skip header if not serialisable
  }

  return {
    allowed: true,
    tenantAccess,
    suiteTenantId,
    response: NextResponse.next({ request: { headers: requestHeaders } })
  };
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

    return result.response ?? NextResponse.next();
  };
}

/**
 * Check specific feature access from a route handler's request.
 * Reads tenant access from the internal header forwarded by the subscription
 * middleware. Returns null when called outside that middleware context.
 */
export function checkFeatureAccess(
  request: NextRequest,
  feature: SuiteFeatureKey
): { allowed: boolean; tenantAccess: TenantModuleAccess } | null {
  const tenantAccess = getTenantAccess(request);
  if (!tenantAccess) return null;

  return {
    allowed: tenantHasFeature(tenantAccess, feature),
    tenantAccess
  };
}

/**
 * Check limit from a route handler's request.
 */
export function checkLimit(
  request: NextRequest,
  limitKey: string
): number | null {
  const tenantAccess = getTenantAccess(request);
  if (!tenantAccess) return null;
  const value = tenantAccess.limits[limitKey];
  return typeof value === 'number' ? value : null;
}

/**
 * Read tenant access from request headers set by the subscription middleware.
 */
export function getTenantAccess(request: NextRequest): TenantModuleAccess | undefined {
  const raw = request.headers.get(SUBSCRIPTION_ACCESS_HEADER);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as TenantModuleAccess;
  } catch {
    return undefined;
  }
}

/**
 * Read suiteTenantId from request headers set by the subscription middleware.
 */
export function getSuiteTenantId(request: NextRequest): string | undefined {
  return request.headers.get(SUBSCRIPTION_TENANT_HEADER) ?? undefined;
}
