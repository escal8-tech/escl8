/**
 * Rate Limiter Utility
 * In-memory rate limiter for single-instance deployments or local development.
 * For distributed deployments, use checkRateLimit from `@/lib/redis` instead.
 * This implementation is used by createRateLimitMiddleware for Next.js API routes
 * where simplicity is preferred over distributed consistency.
 */
import { NextResponse } from 'next/server';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

class RateLimiter {
  private store = new Map<string, RateLimitRecord>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupInterval.unref?.();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (record.resetAt < now) {
        this.store.delete(key);
      }
    }
  }

  checkLimit(identifier: string, config: RateLimitConfig): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfterMs?: number;
  } {
    const key = `${config.keyPrefix}:${identifier}`;
    const now = Date.now();

    let record = this.store.get(key);

    if (!record || record.resetAt < now) {
      record = {
        count: 0,
        resetAt: now + config.windowMs,
      };
    }

    record.count++;
    this.store.set(key, record);

    const allowed = record.count <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - record.count);

    return {
      allowed,
      remaining,
      resetAt: record.resetAt,
      retryAfterMs: allowed ? undefined : record.resetAt - now,
    };
  }

  getStatus(identifier: string, config: RateLimitConfig): {
    count: number;
    remaining: number;
    resetAt: number;
  } | null {
    const key = `${config.keyPrefix}:${identifier}`;
    const record = this.store.get(key);
    if (!record || record.resetAt < Date.now()) return null;
    return {
      count: record.count,
      remaining: Math.max(0, config.maxRequests - record.count),
      resetAt: record.resetAt,
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

export const rateLimiter = new RateLimiter();

export const RATE_LIMITS = {
  AUTH_TOKEN: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    keyPrefix: 'auth_token',
  } as const,

  RECURRING_CHECKOUT: {
    windowMs: 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'recurring_checkout',
  } as const,

  WEBHOOK: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: 'webhook',
  } as const,

  API: {
    windowMs: 60 * 1000,
    maxRequests: 60,
    keyPrefix: 'api',
  } as const,
};

export function createRateLimitMiddleware(config: typeof RATE_LIMITS.AUTH_TOKEN) {
  return async function rateLimitMiddleware(
    request: Request,
    getIdentifier: (request: Request) => string,
    extraHeaders: HeadersInit = {}
  ): Promise<NextResponse | null> {
    const identifier = getIdentifier(request);
    const result = rateLimiter.checkLimit(identifier, config);

    const headers = new Headers(extraHeaders);
    headers.set('X-RateLimit-Limit', String(config.maxRequests));
    headers.set('X-RateLimit-Remaining', String(result.remaining));
    headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      headers.set('Retry-After', String(Math.ceil((result.retryAfterMs || config.windowMs) / 1000)));
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests', retryAfterMs: result.retryAfterMs }),
        {
          status: 429,
          headers,
        }
      );
    }

    return null;
  };
}