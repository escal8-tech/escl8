import { NextRequest, NextResponse } from 'next/server';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';

/**
 * Get client IP for rate limiting
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Check rate limit and return error response if exceeded
 */
export async function checkRateLimit(
  request: NextRequest,
  config: typeof RATE_LIMITS.AUTH_TOKEN | typeof RATE_LIMITS.AUTH_REFRESH
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
      { error: 'Too many requests', retryAfterMs: result.retryAfterMs },
      { status: 429, headers }
    );
  }

  return null;
}
