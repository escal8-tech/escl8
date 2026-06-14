import { getRedisClient, setCached, getCached, delCached } from './redis';
import { REDIS_KEYS } from './redis';

/**
 * Idempotency Key Manager
 * Prevents duplicate mutations by using idempotency keys
 */

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours
const IDEMPOTENCY_PREFIX = 'idempotency:';

export interface IdempotencyResult {
  success: boolean;
  existing?: boolean;
  result?: unknown;
}

export interface IdempotencyOptions {
  ttlSeconds?: number;
  keyPrefix?: string;
}

/**
 * Check if an idempotency key has been used before
 * Returns the cached result if exists, or marks as in-progress
 */
export async function checkIdempotencyKey(
  idempotencyKey: string,
  options: IdempotencyOptions = {}
): Promise<{ exists: boolean; result?: unknown }> {
  const client = await getRedisClient();
  if (!client) return { exists: false }; // Fail-open if no Redis

  const key = `${REDIS_KEYS.RATE_LIMIT}${options.keyPrefix || 'idemp'}:${idempotencyKey}`;
  
  try {
    const existing = await getCached<{ status: string; result?: unknown }>(key);
    
    if (!existing) {
      // Mark as in-progress
      await setCached(key, { status: 'processing', startedAt: Date.now() }, 3600); // 1 hour max for processing
      return { exists: false };
    }
    
    if (existing.status === 'processing') {
      // Request is still being processed - could wait or reject
      return { exists: true, result: { error: 'Request already in progress' } };
    }
    
    // Completed - return cached result
    return { exists: true, result: existing.result };
  } catch (err) {
    console.error('Idempotency check error:', err);
    return { exists: false }; // Fail-open
  }
}

/**
 * Store the result of an idempotent operation
 */
export async function storeIdempotencyResult(
  idempotencyKey: string,
  result: unknown,
  options: IdempotencyOptions = {}
): Promise<void> {
  const client = await getRedisClient();
  if (!client) return; // Fail silently if no Redis

  const key = `${REDIS_KEYS.RATE_LIMIT}${options.keyPrefix || 'idemp'}:${idempotencyKey}`;
  const ttl = options.ttlSeconds || IDEMPOTENCY_TTL;
  
  try {
    await setCached(key, { 
      status: 'completed', 
      completedAt: Date.now(),
      result 
    }, options.ttlSeconds || IDEMPOTENCY_TTL);
  } catch (err) {
    console.error('Failed to store idempotency result:', err);
  }
}

/**
 * Mark an idempotency key as failed (allows retry)
 */
export async function markIdempotencyFailed(
  idempotencyKey: string,
  error: unknown,
  options: IdempotencyOptions = {}
): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  const key = `${REDIS_KEYS.RATE_LIMIT}${options.keyPrefix || 'idemp'}:${idempotencyKey}`;
  
  try {
    await setCached(key, { 
      status: 'failed', 
      failedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error)
    }, 3600); // Keep failures for 1 hour for debugging
  } catch (err) {
    console.error('Failed to mark idempotency failed:', err);
  }
}

/**
 * Middleware wrapper for API routes to add idempotency protection
 */
export function withIdempotency<T extends { idempotencyKey?: string }>(
  handler: (payload: T) => Promise<{ success: boolean; data?: unknown; error?: string }>,
  options: IdempotencyOptions = {}
) {
  return async (payload: T): Promise<{ success: boolean; data?: unknown; error?: string; duplicate?: boolean }> => {
    const idempotencyKey = payload.idempotencyKey;
    
    if (!idempotencyKey) {
      // No idempotency key provided - execute without deduplication
      return handler(payload);
    }

    // Check if already processed
    const { exists, result } = await checkIdempotencyKey(idempotencyKey, options);
    
    if (exists) {
      console.log(`[idempotency] Duplicate request ignored: ${idempotencyKey}`);
      return { 
        success: true, 
        data: result, 
        duplicate: true 
      };
    }

    try {
      const result = await handler(payload);
      
      if (result.success) {
        await storeIdempotencyResult(idempotencyKey, result.data, { ttlSeconds: 24 * 60 * 60 });
      } else {
        // Store failure but allow retry after shorter TTL
        await storeIdempotencyResult(idempotencyKey, result, { ttlSeconds: 300 }); // 5 min for failures
      }
      
      return result;
    } catch (error) {
      await markIdempotencyFailed(idempotencyKey, error);
      throw error;
    }
  };
}