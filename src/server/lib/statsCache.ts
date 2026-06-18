type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<any>>();

/**
 * A simple in-memory cache for statistics and expensive read operations.
 * Use this only for data that is acceptable to be slightly stale (e.g., dashboard counters).
 */
export async function withStatsCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const data = await fetcher();
  cache.set(key, {
    data,
    expiresAt: now + ttlSeconds * 1000,
  });

  return data;
}

/**
 * Clears the entire stats cache.
 */
export function clearStatsCache(): void {
  cache.clear();
}

/**
 * Removes a specific key from the cache.
 */
export function invalidateStatsCache(key: string): void {
  cache.delete(key);
}
