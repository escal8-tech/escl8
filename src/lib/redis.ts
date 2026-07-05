import { createClient, createCluster, RedisClientType, RedisClusterType } from 'redis';

// Redis configuration from environment/secrets
function getRedisConfig() {
  const url = process.env.REDIS_URL || process.env.REDIS_CONNECTION_STRING;
  const host = process.env.REDIS_HOST || process.env.REDIS_HOST_NAME;
  const port = parseInt(process.env.REDIS_PORT || process.env.REDIS_PORT_NUMBER || '6380', 10);
  const password = process.env.REDIS_PASSWORD || process.env.REDIS_PRIMARY_KEY || process.env.REDIS_KEY;
  const clusterMode = String(process.env.REDIS_CLUSTER_MODE || '').trim().toLowerCase();
  const isCluster = clusterMode
    ? clusterMode !== 'false' && clusterMode !== '0' && clusterMode !== 'no'
    : Boolean(host && password);

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
const REDIS_CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000);

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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
      await withTimeout(
        Promise.resolve(client.connect()).then(() => undefined),
        REDIS_CONNECT_TIMEOUT_MS,
        'Redis connection',
        () => {
          void client.destroy?.();
        }
      );
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
    console.error("Redis DEL error:", err);
    return false;
  }
}

/**
 * Removes all keys matching a prefix.
 * Uses SCAN to avoid blocking the server.
 */
export async function scanDelCached(prefix: string): Promise<number> {
  const client = await getRedisClient();
  if (!client) return 0;

  try {
    let cursor = 0;
    let deletedCount = 0;
    do {
      const result = await client.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 });
      cursor = result.cursor;
      const keys = result.keys;
      if (keys.length > 0) {
        await client.del(keys);
        deletedCount += keys.length;
      }
    } while (cursor !== 0);
    return deletedCount;
  } catch (err) {
    console.error("Redis SCANDEL error:", err);
    return 0;
  }
}

/**
 * A centralized Redis-based caching helper to provide a consistent pattern for service-level caching.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await getCached<T>(key);
  if (cached !== null) return cached;

  const data = await fetcher();
  await setCached(key, data, ttlSeconds);
  return data;
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

export async function withLock<T>(lockKey: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const acquired = await acquireLock(lockKey, ttlSeconds);
  if (!acquired) {
    throw new Error(`Failed to acquire lock for key: ${lockKey}`);
  }
  try {
    return await fn();
  } finally {
    await releaseLock(lockKey);
  }
}


