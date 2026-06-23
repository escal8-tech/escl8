import { NextResponse, type NextRequest } from 'next/server'
import { verifyAccessToken, tokenGetBusinessId } from '@/lib/jwt-edge'

// Paths that don't need auth protection (prefix match)
const PUBLIC_PATHS = [
  '/_next',
  '/api/billing/senangpay',
  '/api/billing/recurring-checkout',
  '/api/widget',
  '/api/internal/orders/invoice',
  '/api/internal/orders/payment-proof',
  '/api/sentry-example-api',
  '/api/sentry-example-log',
  '/book',
  '/pricing',
  '/subscription',
  '/auth',
  '/access',
  '/static',
  '/track',
] as const

// Exact-match public endpoints (no prefix expansion)
const PUBLIC_EXACT = [
  '/',
  '/sitemap.xml',
  '/robots.txt',
  '/favicon.ico',
  '/api/auth/token',
  '/api/auth/refresh',
  '/api/health',
  '/api/ready',
  '/api/monitoring/health',
] as const
const ASSET_REGEX = /\.(ico|png|jpg|jpeg|svg|css|js|woff|woff2|webp|avif)$/i

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname as typeof PUBLIC_EXACT[number])) return true
  if (ASSET_REGEX.test(pathname)) return true
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

const ALLOWED_ORIGIN_SUFFIXES = ['.escal8.tech', '.escal8.com']
const EXACT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'capacitor://localhost', 'ionic://localhost']

function getAllowedOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return EXACT_ALLOWED_ORIGINS[0]
  
  if (EXACT_ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin
  }
  
  try {
    const url = new URL(requestOrigin)
    if (ALLOWED_ORIGIN_SUFFIXES.some(suffix => url.hostname.endsWith(suffix) || url.hostname === suffix.slice(1))) {
      return requestOrigin
    }
  } catch {
    // Invalid URL, fall through
  }
  
  return EXACT_ALLOWED_ORIGINS[0]
}

/**
 * Enterprise Auth Middleware - Single Auth Boundary
 * 
 * Validates Escal8 JWT from HttpOnly cookie, extracts all claims,
 * and sets headers for downstream consumption (pages, API, tRPC).
 * 
 * Flow:
 * 1. Check for escal8_access_token cookie
 * 2. Verify JWT signature, expiry, blacklist
 * 3. Extract: firebaseUid, email, suiteTenantId, businessId, subscription claims
 * 4. Set request headers via NextResponse.next({ request: { headers } }) for downstream
 * 5. If invalid/missing → redirect to /auth/login?redirect=<original>
 * 6. Login page exchanges Firebase token → Escal8 JWT cookies → redirects back
 * 7. Middleware validates new cookies → allows through
 */
export async function middleware(request: NextRequest) {
  // PREVENT HEADER SPOOFING: Strip all internal identity/context headers from the incoming request.
  // These will be re-populated by this middleware from the validated JWT claims.
  const headersToStrip = [
    'x-firebase-uid',
    'x-user-email',
    'x-suite-tenant-id',
    'x-user-id',
    'x-business-id',
    'x-subscription-status',
    'x-plan-code',
    'x-workspace-mode',
    'x-grant-kind',
    'x-is-special-grant',
    'x-subscription-features',
    'x-subscription-limits',
    'x-api-key',
  ];
  headersToStrip.forEach((header) => request.headers.delete(header));

  const pathname = request.nextUrl.pathname

  const origin = request.headers.get('origin')
  const allowedOrigin = getAllowedOrigin(origin)

  // Handle preflight OPTIONS requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-business-id',
      },
    })
  }

  // Skip public paths
  if (isPublicPath(pathname)) {
    const response = NextResponse.next()
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-business-id')
    return response
  }

  // Extract access token from cookie
  const accessToken = request.cookies.get('escal8_access_token')?.value

  if (!accessToken) {
    if (pathname.startsWith('/api/')) {
      // Allow TRPC to handle authentication for its own routes.
      // publicProcedures will succeed, protectedProcedures will throw 401.
      if (pathname.startsWith('/api/trpc/')) {
        const response = NextResponse.next()
        response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
        response.headers.set('Access-Control-Allow-Credentials', 'true')
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-business-id')
        return response
      }
      
      const response = NextResponse.json({ error: 'unauthorized', reason: 'token_missing' }, { status: 401 })
      response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      return response
    }
    // No JWT cookie - redirect to login to establish session
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Verify JWT
  const payload = await verifyAccessToken(accessToken)

  if (!payload) {
    if (pathname.startsWith('/api/')) {
      // Allow TRPC to handle authentication for its own routes (fallback to anonymous)
      if (pathname.startsWith('/api/trpc/')) {
        const response = NextResponse.next()
        response.cookies.set('escal8_access_token', '', { maxAge: 0, path: '/' })
        response.cookies.set('escal8_refresh_token', '', { maxAge: 0, path: '/' })
        response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
        response.headers.set('Access-Control-Allow-Credentials', 'true')
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-business-id')
        return response
      }

      const response = NextResponse.json({ error: 'unauthorized', reason: 'token_invalid' }, { status: 401 })
      response.cookies.set('escal8_access_token', '', { maxAge: 0, path: '/' })
      response.cookies.set('escal8_refresh_token', '', { maxAge: 0, path: '/' })
      response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      return response
    }
    // Invalid/expired token - clear cookie and redirect to login
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    loginUrl.searchParams.set('reason', 'token_invalid')
    const response = NextResponse.redirect(loginUrl)
    response.cookies.set('escal8_access_token', '', { maxAge: 0, path: '/' })
    response.cookies.set('escal8_refresh_token', '', { maxAge: 0, path: '/' })
    return response
  }

  // JWT valid - extract all claims
  if (payload.type !== 'access') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized', reason: 'invalid_token_type' }, { status: 401 })
    }
    const loginUrl = new URL('/auth/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  const { sub: firebaseUid, email, suiteTenantId, subscription, userId } = payload

  if (!firebaseUid || !email || !suiteTenantId || !subscription) {
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json({ error: 'unauthorized', reason: 'token_malformed' }, { status: 401 })
      response.cookies.set('escal8_access_token', '', { maxAge: 0, path: '/' })
      response.cookies.set('escal8_refresh_token', '', { maxAge: 0, path: '/' })
      response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      return response
    }
    // Malformed token - missing required claims
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    loginUrl.searchParams.set('reason', 'token_malformed')
    const response = NextResponse.redirect(loginUrl)
    response.cookies.set('escal8_access_token', '', { maxAge: 0, path: '/' })
    response.cookies.set('escal8_refresh_token', '', { maxAge: 0, path: '/' })
    return response
  }

  // Get businessId from JWT (cached at token generation time)
  const businessId: string | null = tokenGetBusinessId(payload)

  // Check subscription access for agent module
  const hasAgentAccess = subscription.grantsAgent === true || subscription.isSpecialGrant === true
  const workspaceMode = subscription.workspaceMode || 'blocked'

  if (!hasAgentAccess || workspaceMode === 'blocked') {
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json({ error: 'forbidden', reason: 'inactive_subscription' }, { status: 403 })
      response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      return response
    }
    const loginUrl = new URL('/subscription', request.url)
    loginUrl.searchParams.set('reason', 'inactive_subscription')
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Build headers for downstream consumers (tRPC, API routes, Server Components)
  // CRITICAL: Must clone request headers and pass via NextResponse.next({ request: { headers } })
  const requestHeaders = new Headers(request.headers)

  // Core identity headers
  requestHeaders.set('x-firebase-uid', firebaseUid)
  requestHeaders.set('x-user-email', email)
  requestHeaders.set('x-suite-tenant-id', suiteTenantId)
  if (userId) {
    requestHeaders.set('x-user-id', userId)
  }

  // Business context (critical for tRPC, Server Components, API routes)
  if (businessId) {
    requestHeaders.set('x-business-id', businessId)
  }

  // Subscription status headers
  requestHeaders.set('x-subscription-status', subscription.status || 'none')
  requestHeaders.set('x-plan-code', subscription.planCode || 'none')
  requestHeaders.set('x-workspace-mode', workspaceMode)
  requestHeaders.set('x-grant-kind', subscription.grantKind || 'standard')
  requestHeaders.set('x-is-special-grant', String(subscription.isSpecialGrant || false))

  // Full subscription data as JSON (for Server Components that need features/limits)
  requestHeaders.set('x-subscription-features', JSON.stringify(subscription.features || {}))
  requestHeaders.set('x-subscription-limits', JSON.stringify(subscription.limits || {}))

  // Pass modified headers to downstream via request option
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  // Add CORS headers to support cross-origin API and tRPC requests
  response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-business-id')

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.png$).*)',
  ],
}