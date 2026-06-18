import { createClient, createCluster, RedisClientType, RedisClusterType } from 'redis';

// Redis configuration from environment/secrets
function getRedisConfig() {
  const url = process.env.REDIS_URL || process.env.REDIS_CONNECTION_STRING;
  const host = process.env.REDIS_HOST || process.env.REDIS_HOST_NAME;
  const port = parseInt(process.env.REDIS_PORT || process.env.REDIS_PORT_NUMBER || '6380', 10);
  const password = process.env.REDIS_PASSWORD || process.env.REDIS_PRIMARY_KEY || process.env.REDIS_KEY;
  const isCluster = process.env.REDIS_CLUSTER_MODE === 'true';

  if (url && !isCluster) return { url, isCluster };

  if (!host && !url) {
    console.warn('Redis configuration incomplete - running without cache');
    return null;
  }

  return { host: host || new URL(url!).hostname, port: port || parseInt(new URL(url!).port || '6380', 10), password, isCluster, url };
}

type AnyRedisClient = RedisClientType | RedisClusterType;

let redisClient: AnyRedisClient | null = null;
let isConnecting = false;
let connectionPromise: Promise<AnyRedisClient> | null = null;

export async function getRedisClient(): Promise<AnyRedisClient | null> {
  if (redisClient?.isOpen) return redisClient;
  
  if (isConnecting && connectionPromise) {
    return connectionPromise;
  }

  const config = getRedisConfig();
  if (!config) return null;

  isConnecting = true;
  connectionPromise = (async () => {
    const reconnectStrategy = (retries: number) => {
      if (retries > 10) return new Error('Max retries reached');
      return Math.min(retries * 100, 3000);
    };
    const useTls = String(process.env.REDIS_TLS ?? 'true').toLowerCase() !== 'false';
    
    let client: AnyRedisClient;
    
    if (config.isCluster) {
      // Azure Managed Redis requires cluster mode
      client = createCluster({
        rootNodes: [
          {
            url: config.url || (useTls ? `rediss://${config.host}:${config.port}` : `redis://${config.host}:${config.port}`)
          }
        ],
        defaults: {
          password: config.password || undefined,
        }
      });
    } else {
      client = createClient(
        config.url
          ? { url: config.url }
          : {
              socket: useTls
                ? { host: config.host, port: config.port, tls: true as const, reconnectStrategy }
                : { host: config.host, port: config.port, reconnectStrategy },
              password: config.password || undefined,
            },
      );
    }

    client.on('error', (err: Error) => {
      console.error('Redis Client Error:', err);
    });

    client.on('connect', () => {
      console.log('Redis connected' + (config.isCluster ? ' (Cluster Mode)' : ''));
    });

    client.on('reconnecting', () => {
      console.log('Redis reconnecting...');
    });

    try {
      await client.connect();
      redisClient = client;
      return client;
    } finally {
      isConnecting = false;
      connectionPromise = null;
    }
  })();

  try {
    return await connectionPromise;
  } catch (error) {
    console.error('Redis connection failed:', error);
    return null;
  }
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    redisClient = null;
  }
}

export function isRedisAvailable(): boolean {
  return getRedisConfig() !== null;
}

// Key prefixes for different data types
export const REDIS_KEYS = {
  // Subscription caching
  SUBSCRIPTION: 'sub:access:',           // TenantModuleAccess cached by suiteTenantId:module
  SUBSCRIPTION_TTL: 300,                 // 5 minutes
  
  // Webhook replay protection
  WEBHOOK_REPLAY: 'webhook:replay:',     // Idempotency keys
  WEBHOOK_REPLAY_TTL: 86400,             // 24 hours
  
  // Rate limiting
  RATE_LIMIT: 'ratelimit:',              // Rate limit counters
  RATE_LIMIT_TTL: 60,                    // 1 minute window
  
  // JWT token blacklist (for logout/revocation)
  TOKEN_BLACKLIST: 'token:blacklist:',   // Revoked tokens
  TOKEN_BLACKLIST_TTL: 604800,           // 7 days (match refresh token TTL)
  
  // Session data (for distributed systems)
  SESSION: 'session:',                   // Session data
  SESSION_TTL: 1800                      // 30 minutes
};

// Generic cache operations
export async function getCached<T>(key: string): Promise<T | null> {
  const client = await getRedisClient();
  if (!client) return null;
  
  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('Redis GET error:', err);
    return null;
  }
}

export async function setCached(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  
  try {
    await client.setEx(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('Redis SET error:', err);
    return false;
  }
}

export async function delCached(key: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  
  try {
    await client.del(key);
    return true;
  } catch (err) {
    console.error('Redis DEL error:', err);
    return false;
  }
}

export async function existsCached(key: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  
  try {
    return await client.exists(key) === 1;
  } catch (err) {
    console.error('Redis EXISTS error:', err);
    return false;
  }
}

// Distributed lock implementation
export async function acquireLock(lockKey: string, ttlSeconds: number = 30): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  
  try {
    const result = await client.set(lockKey, Date.now().toString(), {
      NX: true,
      EX: ttlSeconds
    });
    return result === 'OK';
  } catch (err) {
    console.error('Redis LOCK error:', err);
    return false;
  }
}

export async function releaseLock(lockKey: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  
  try {
    await client.del(lockKey);
    return true;
  } catch (err) {
    console.error('Redis UNLOCK error:', err);
    return false;
  }
}

// Rate limiting with sliding window
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
  limit: number;
  windowMs: number;
  source: 'redis' | 'fallback';
}

export async function checkRateLimit(
  identifier: string, 
  limit: number, 
  windowMs: number,
  keyPrefix: string = 'ratelimit'
): Promise<RateLimitResult> {
  const client = await getRedisClient();
  if (!client) {
    // Allow if Redis unavailable (fail-open)
    return { 
      allowed: true, 
      remaining: limit, 
      resetAt: Date.now() + windowMs,
      limit,
      windowMs,
      source: 'fallback'
    };
  }

  const key = `${REDIS_KEYS.RATE_LIMIT}${keyPrefix}:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    // Use sorted set for sliding window
    const multi = client.multi();
    multi.zRemRangeByScore(key, 0, windowStart);
    multi.zCard(key);
    multi.zAdd(key, { score: now, value: `${now}:${Math.random()}` });
    multi.expire(key, Math.ceil(windowMs / 1000) + 1);
    
    const results = await multi.exec();
    // results[1] is the zCard result
    const currentCount = Number(results[1]) || 0;
    
    const allowed = currentCount < limit;
    const remaining = Math.max(0, limit - currentCount - 1);
    const resetAt = now + windowMs;
    
    return {
      allowed,
      remaining,
      resetAt,
      retryAfterMs: allowed ? undefined : windowMs,
      limit,
      windowMs,
      source: 'redis'
    };
  } catch (err) {
    console.error('Rate limit check error:', err);
    // Fail-open
    return { 
      allowed: true, 
      remaining: limit, 
      resetAt: Date.now() + windowMs,
      limit,
      windowMs,
      source: 'fallback'
    };
  }
}
