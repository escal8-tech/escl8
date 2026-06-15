import { NextResponse, type NextRequest } from 'next/server';
import { getSubscriptionContext } from '@/lib/subscription-middleware';
import { SUITE_FEATURES, type SuiteFeatureKey, hasFeature } from '@/server/control/subscription-features';

// Routes that require module access (Agent dashboard)
const PROTECTED_ROUTES: Array<{ path: string; module: 'agent' | 'reservation'; features?: SuiteFeatureKey[] }> = [
  { path: '/dashboard', module: 'agent', features: [] },
  { path: '/messages', module: 'agent', features: [] },
  { path: '/whatsapp', module: 'agent', features: [] },
  { path: '/widget', module: 'agent', features: [] },
  { path: '/analytics', module: 'agent', features: [SUITE_FEATURES.AGENT_ANALYTICS_VIEW] },
  { path: '/settings', module: 'agent', features: [] },
  { path: '/contacts', module: 'agent', features: [] },
  { path: '/campaigns', module: 'agent', features: [] },
  { path: '/flows', module: 'agent', features: [] },
  { path: '/integrations', module: 'agent', features: [] },
];

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function getRouteConfig(pathname: string): { module: 'agent' | 'reservation'; features?: SuiteFeatureKey[] } | null {
  for (const config of PROTECTED_ROUTES) {
    if (matchesRoute(pathname, config.path)) {
      return config;
    }
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip public routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/billing/senangpay') ||
    pathname.startsWith('/api/monitoring') ||
    pathname.startsWith('/widget') || // public widget
    pathname === '/' ||
    pathname === '/pricing' ||
    pathname === '/subscription' ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/static') ||
    /\.(ico|png|jpg|jpeg|svg|css|js|woff|woff2)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const routeConfig = getRouteConfig(pathname);
  if (!routeConfig) {
    return NextResponse.next();
  }

  const context = await getSubscriptionContext(request);
  if (!context) {
    const loginUrl = new URL('/subscription', request.url);
    loginUrl.searchParams.set('reason', 'not_authenticated');
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const { tenantAccess } = context;

  // Check agent module access
  const hasAgentAccess = tenantAccess.features?.[SUITE_FEATURES.AGENT_PORTAL_VIEW] === true || tenantAccess.isGrandfathered;

  if (!hasAgentAccess || !tenantAccess.allowed) {
    const loginUrl = new URL('/subscription', request.url);
    loginUrl.searchParams.set('reason', 'inactive_subscription');
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Check feature access
  if (routeConfig.features && routeConfig.features.length > 0) {
    for (const feature of routeConfig.features) {
      const hasFeatureAccess = hasFeature(tenantAccess.features, feature);
      if (!hasFeatureAccess) {
        const loginUrl = new URL('/subscription', request.url);
        loginUrl.searchParams.set('reason', 'feature_locked');
        loginUrl.searchParams.set('feature', feature);
        loginUrl.searchParams.set('redirect', pathname);
        return NextResponse.redirect(loginUrl);
      }
    }
  }

  const response = NextResponse.next();
  response.headers.set('x-suite-tenant-id', context.suiteTenantId);
  response.headers.set('x-subscription-status', tenantAccess.subscriptionStatus || 'none');
  response.headers.set('x-plan-code', tenantAccess.planCode || 'none');
  response.headers.set('x-workspace-mode', tenantAccess.workspaceMode);

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.png$).*)',
  ],
};