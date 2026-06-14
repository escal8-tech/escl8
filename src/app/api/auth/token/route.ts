import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseIdToken } from '@/server/firebaseAdmin';
import { queryRows } from '@/lib/db';
import { 
  generateTokenPair, 
  verifyRefreshToken, 
  refreshAccessToken,
  validateAuthToken 
} from '@/lib/jwt-auth';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { setAuthCookies, clearAuthCookies, blacklistToken } from '@/lib/auth-cookies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Get client IP for rate limiting
 */
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Check rate limit and return error response if exceeded
 */
async function checkRateLimit(
  request: NextRequest,
  config: typeof RATE_LIMITS.AUTH_TOKEN
): Promise<NextResponse | null> {
  const identifier = getClientIp(request);
  const result = rateLimiter.checkLimit(identifier, config);

  const headers = new Headers();
  headers.set('X-RateLimit-Limit', String(config.maxRequests));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

  if (!result.allowed) {
    headers.set('Retry-After', String(Math.ceil((result.retryAfterMs || config.windowMs) / 1000)));
    return NextResponse.json(
      { error: 'Too many requests', retryAfterMs: result.retryAfterMs },
      { status: 429, headers }
    );
  }

  return null;
}

/**
 * POST /api/auth/token - Exchange Firebase ID token for Escal8 JWT pair
 * Body: { idToken: string, module?: 'agent' | 'reservation' }
 * Rate limited: 10 requests per minute per IP
 * Returns: Sets httpOnly cookies (accessToken, refreshToken)
 */
export async function POST(request: NextRequest) {
  const rateLimitError = await checkRateLimit(request, RATE_LIMITS.AUTH_TOKEN);
  if (rateLimitError) return rateLimitError;

  try {
    const body = await request.json();
    const { idToken, module = 'agent' } = body;

    if (!idToken) {
      return NextResponse.json({ error: 'idToken is required' }, { status: 400 });
    }

    // Verify Firebase ID token
    let decoded;
    try {
      decoded = await verifyFirebaseIdToken(idToken);
    } catch {
      return NextResponse.json({ error: 'Invalid Firebase token' }, { status: 401 });
    }

    const firebaseUid = String(decoded.uid || '').trim();
    const email = String(decoded.email || '').trim().toLowerCase();
    
    if (!firebaseUid || !email) {
      return NextResponse.json({ error: 'Invalid token payload' }, { status: 401 });
    }

    // Look up tenant via suite_memberships
    const rows = await queryRows<{ id: string }>(
      'control',
      `
      SELECT st.id
      FROM suite_tenants st
      JOIN suite_memberships sm ON sm.suite_tenant_id = st.id
      JOIN suite_users su ON su.id = sm.suite_user_id
      WHERE su.firebase_uid = $1 AND sm.status = 'active'
      LIMIT 1
      `,
      [firebaseUid]
    );

    const suiteTenantId = rows[0]?.id;
    if (!suiteTenantId) {
      return NextResponse.json({ error: 'No active tenant found for user' }, { status: 403 });
    }

    // Generate token pair
    const tokens = await generateTokenPair(firebaseUid, email, suiteTenantId, module as 'agent' | 'reservation');

    // Return response with httpOnly cookies set
    const response = NextResponse.json({ 
      success: true, 
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer' 
    });
    
    return setAuthCookies(response, tokens.accessToken, tokens.refreshToken);
  } catch (error) {
    console.error('[auth/token] Error:', error);
    return NextResponse.json({ error: 'Token generation failed' }, { status: 500 });
  }
}

/**
 * POST /api/auth/refresh - Refresh access token using refresh token
 * Body: { refreshToken?: string } (optional - reads from cookie if not provided)
 * Rate limited: 10 requests per minute per IP
 * Returns: Sets httpOnly cookie (new accessToken)
 */
export async function PUT(request: NextRequest) {
  const rateLimitError = await checkRateLimit(request, RATE_LIMITS.AUTH_TOKEN);
  if (rateLimitError) return rateLimitError;

  try {
    // Prefer cookie, fallback to body
    let refreshToken = request.cookies.get('escal8_refresh_token')?.value;
    
    if (!refreshToken) {
      const body = await request.json();
      refreshToken = body.refreshToken;
    }

    if (!refreshToken) {
      return NextResponse.json({ error: 'refreshToken is required (cookie or body)' }, { status: 400 });
    }

    const tokens = await refreshAccessToken(refreshToken, 'agent');
    if (!tokens) {
      return NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 });
    }

    const response = NextResponse.json({ 
      success: true, 
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer' 
    });
    
    // Set new access token in cookie (refresh token stays the same unless rotated)
    return setAuthCookies(response, tokens.accessToken, tokens.refreshToken);
  } catch (error) {
    console.error('[auth/refresh] Error:', error);
    return NextResponse.json({ error: 'Token refresh failed' }, { status: 500 });
  }
}

/**
 * POST /api/auth/logout - Clear auth cookies and blacklist tokens
 */
export async function DELETE(request: NextRequest) {
  // Get tokens from cookies to blacklist
  const accessToken = request.cookies.get('escal8_access_token')?.value;
  const refreshToken = request.cookies.get('escal8_refresh_token')?.value;
  
  // Blacklist both tokens
  await Promise.all([
    accessToken ? blacklistToken(accessToken) : Promise.resolve(),
    refreshToken ? blacklistToken(refreshToken) : Promise.resolve()
  ]);
  
  const response = NextResponse.json({ success: true, message: 'Logged out' });
  return clearAuthCookies(response);
}

/**
 * GET /api/auth/verify - Verify access token and return subscription claims
 */
export async function GET(request: NextRequest) {
  try {
    const result = await validateAuthToken(request);
    
    if (!result.valid) {
      return NextResponse.json({ valid: false, error: result.error }, { status: 401 });
    }

    return NextResponse.json({
      valid: true,
      payload: {
        sub: result.payload!.sub,
        email: result.payload!.email,
        suiteTenantId: result.payload!.suiteTenantId,
        subscription: result.payload!.subscription,
      },
    });
  } catch (error) {
    console.error('[auth/verify] Error:', error);
    return NextResponse.json({ valid: false, error: 'Verification failed' }, { status: 500 });
  }
}