import { serialize, parse } from 'cookie';
import { NextResponse, NextRequest } from 'next/server';
import { blacklistToken } from '@/lib/jwt-auth';

/**
 * Server-side cookie-based JWT storage
 * Replaces localStorage to prevent XSS token theft
 */

// Cookie configuration
const COOKIE_CONFIG = {
  accessToken: 'escal8_access_token',
  refreshToken: 'escal8_refresh_token',
  
  // Secure cookie options - production hardened
  options: {
    accessToken: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 15 * 60, // 15 minutes
      path: '/',
      // domain: process.env.COOKIE_DOMAIN // Set if using subdomains
    },
    refreshToken: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
      // domain: process.env.COOKIE_DOMAIN
    }
  }
};

/**
 * Set JWT tokens as httpOnly cookies in the response
 */
export function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string
): NextResponse {
  // Access token cookie
  response.headers.set(
    'Set-Cookie',
    serialize(COOKIE_CONFIG.accessToken, accessToken, COOKIE_CONFIG.options.accessToken)
  );
  
  // Add refresh token cookie
  response.headers.append(
    'Set-Cookie',
    serialize(COOKIE_CONFIG.refreshToken, refreshToken, COOKIE_CONFIG.options.refreshToken)
  );
  
  return response;
}

/**
 * Clear auth cookies (logout)
 */
export function clearAuthCookies(response: NextResponse): NextResponse {
  response.headers.set(
    'Set-Cookie',
    serialize(COOKIE_CONFIG.accessToken, '', {
      ...COOKIE_CONFIG.options.accessToken,
      maxAge: 0 // Expire immediately
    })
  );
  
  response.headers.append(
    'Set-Cookie',
    serialize(COOKIE_CONFIG.refreshToken, '', {
      ...COOKIE_CONFIG.options.refreshToken,
      maxAge: 0
    })
  );
  
  return response;
}

/**
 * Extract tokens from request cookies
 */
export function getTokensFromCookies(request: NextRequest): {
  accessToken: string | null;
  refreshToken: string | null;
} {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return { accessToken: null, refreshToken: null };
  }
  
  const cookies = parse(cookieHeader);
  
  return {
    accessToken: cookies[COOKIE_CONFIG.accessToken] || null,
    refreshToken: cookies[COOKIE_CONFIG.refreshToken] || null
  };
}

/**
 * Extract access token from request (for middleware)
 */
export function getAccessTokenFromRequest(request: NextRequest): string | null {
  const { accessToken } = getTokensFromCookies(request);
  return accessToken;
}

/**
 * Extract refresh token from request
 */
export function getRefreshTokenFromRequest(request: NextRequest): string | null {
  const { refreshToken } = getTokensFromCookies(request);
  return refreshToken;
}

/**
 * Create response with auth cookies set
 */
export function createAuthResponse(
  accessToken: string,
  refreshToken: string,
  data: unknown = { success: true },
  status: number = 200
): NextResponse {
  const response = NextResponse.json(data, { status });
  return setAuthCookies(response, accessToken, refreshToken);
}

/**
 * Create logout response (clears cookies)
 */
export function createLogoutResponse(
  data: unknown = { success: true },
  status: number = 200
): NextResponse {
  const response = NextResponse.json(data, { status });
  return clearAuthCookies(response);
}

/**
 * Get token from request - supports both cookie and Authorization header
 * Priority: Cookie > Authorization header
 */
export function getTokenFromRequest(request: NextRequest): string | null {
  // First try cookie (preferred for XSS protection)
  const cookieToken = getAccessTokenFromRequest(request);
  if (cookieToken) return cookieToken;
  
  // Fallback to Authorization header (for API clients, webhooks)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  return null;
}

/**
 * Check if request has valid cookie-based auth
 */
export function hasCookieAuth(request: NextRequest): boolean {
  const { accessToken } = getTokensFromCookies(request);
  return !!accessToken;
}

export { blacklistToken };