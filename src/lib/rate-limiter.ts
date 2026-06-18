/**
 * Rate Limiter Utility
 * Uses Redis when configured so limits apply across scaled replicas; falls back
 * to in-memory limits in local/degraded environments.
 */
import { NextResponse } from 'next/server';
import { checkRateLimit as checkRedisRateLimit } from '@/lib/redis';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyPrefix: string;     // Prefix for the rate limit key
}

class RateLimiter {
  private store = new Map<string, RateLimitRecord>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired entries every 5 minutes
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

  /**
   * Check and consume a rate limit slot
   * Returns { allowed: boolean, remaining: number, resetAt: number, retryAfterMs?: number }
   */
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
      // First request in window or window expired
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

  async checkLimitAsync(identifier: string, config: RateLimitConfig): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfterMs?: number;
  }> {
    const redisResult = await checkRedisRateLimit(identifier, config.maxRequests, config.windowMs, config.keyPrefix)
    if (redisResult.source === 'redis') {
      return redisResult
    }
    return this.checkLimit(identifier, config)
  }

  /**
   * Get current status without consuming
   */
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

// Singleton instance
export const rateLimiter = new RateLimiter();

// Pre-configured limiters
export const RATE_LIMITS = {
  // Auth token endpoint - 30 requests per minute per IP (allows for login retry loops)
  AUTH_TOKEN: {
    windowMs: 60 * 1000,     // 1 minute
    maxRequests: 30,
    keyPrefix: 'auth_token',
  } as const,

  // Recurring checkout - moderate: 5 requests per minute per user
  RECURRING_CHECKOUT: {
    windowMs: 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'recurring_checkout',
  } as const,

  // Webhook endpoints - generous: 100 requests per minute per IP
  WEBHOOK: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: 'webhook',
  } as const,

  // General API - moderate
  API: {
    windowMs: 60 * 1000,
    maxRequests: 60,
    keyPrefix: 'api',
  } as const,
};

/**
 * Create rate limit middleware for an endpoint
 */
export function createRateLimitMiddleware(config: typeof RATE_LIMITS.AUTH_TOKEN) {
  return async function rateLimitMiddleware(
    request: Request,
    getIdentifier: (request: Request) => string,
    extraHeaders: HeadersInit = {}
  ): Promise<NextResponse | null> {
    const identifier = getIdentifier(request);
    const result = await rateLimiter.checkLimitAsync(identifier, config);

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

    return null; // Allow request
  };
}
