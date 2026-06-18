import { NextRequest, NextResponse } from 'next/server';
import { refreshAccessToken } from '@/lib/jwt-auth';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { setAuthCookies } from '@/lib/auth-cookies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

async function checkRateLimit(
  request: NextRequest,
  config: typeof RATE_LIMITS.AUTH_TOKEN
): Promise<NextResponse | null> {
  const identifier = getClientIp(request);
  const result = await rateLimiter.checkLimitAsync(identifier, config);

  const headers = new Headers();
  headers.set('X-RateLimit-Limit', String(config.maxRequests));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

  if (!result.allowed) {
    headers.set('Retry-After', String(Math.ceil((result.retryAfterMs || config.windowMs) / 1000)));
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers }
    );
  }

  return null;
}

/**
 * PUT /api/auth/refresh - Refresh access token using refresh token
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
      const body = await request.json().catch(() => ({}));
      refreshToken = body.refreshToken;
    }

    if (!refreshToken) {
      return NextResponse.json({ error: 'refreshToken is required (cookie or body)' }, { status: 400 });
    }

    const tokens = await refreshAccessToken(refreshToken, 'reservation');
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
