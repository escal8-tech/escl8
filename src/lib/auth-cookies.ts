import { serialize, parse } from 'cookie';
import { NextResponse, NextRequest } from 'next/server';
import { blacklistToken } from '@/lib/jwt-auth';

/**
 * Server-side cookie-based JWT storage
 * Replaces localStorage to prevent XSS token theft
 */

const COOKIE_NAMES = {
  accessToken: 'escal8_access_token',
  refreshToken: 'escal8_refresh_token',
} as const;

const COOKIE_OPTIONS = {
  accessToken: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 15 * 60, // 15 minutes
    path: '/',
  },
  refreshToken: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: '/',
  },
};

/**
 * Set JWT tokens as httpOnly cookies in the response
 * Uses serialize + manual Set-Cookie headers for maximum reliability
 */
export function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string
): NextResponse {
  // Set access token cookie
  response.cookies.set(COOKIE_NAMES.accessToken, accessToken, COOKIE_OPTIONS.accessToken);

  // Set refresh token cookie
  response.cookies.set(COOKIE_NAMES.refreshToken, refreshToken, COOKIE_OPTIONS.refreshToken);

  return response;
}

/**
 * Clear auth cookies (logout)
 */
export function clearAuthCookies(response: NextResponse): NextResponse {
  response.cookies.delete(COOKIE_NAMES.accessToken);
  response.cookies.delete(COOKIE_NAMES.refreshToken);

  return response;
}

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
    accessToken: cookies[COOKIE_NAMES.accessToken] || null,
    refreshToken: cookies[COOKIE_NAMES.refreshToken] || null
  };
}

export function getAccessTokenFromRequest(request: NextRequest): string | null {
  const { accessToken } = getTokensFromCookies(request);
  return accessToken;
}

export function getRefreshTokenFromRequest(request: NextRequest): string | null {
  const { refreshToken } = getTokensFromCookies(request);
  return refreshToken;
}

export function createAuthResponse(
  accessToken: string,
  refreshToken: string,
  data: unknown = { success: true },
  status: number = 200
): NextResponse {
  const response = NextResponse.json(data, { status });
  return setAuthCookies(response, accessToken, refreshToken);
}

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

export function hasCookieAuth(request: NextRequest): boolean {
  const { accessToken } = getTokensFromCookies(request);
  return !!accessToken;
}

export { blacklistToken };