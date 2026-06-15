import { createHash } from 'crypto';
import { getRedisClient, existsCached, setCached, getCached } from './redis';
import { REDIS_KEYS } from './redis';

/**
 * Webhook Replay Protection - Redis-backed
 * Provides idempotency keys for webhook processing to prevent duplicate execution
 */

export const webhookReplayStore = {
  /**
   * Try to claim a webhook ID for processing
   * Returns true if this is the first time seeing this ID
   */
  async tryClaim(id: string, payload: object): Promise<boolean> {
    const client = await getRedisClient();
    if (!client) return true; // Fail-open if Redis unavailable
    
    const key = `${REDIS_KEYS.WEBHOOK_REPLAY}${id}`;
    const now = Date.now();
    const ttlMs = REDIS_KEYS.WEBHOOK_REPLAY_TTL * 1000;

    const existing = await getCached<{ processedAt: number; result?: string }>(key);
    if (existing) {
      if (now - existing.processedAt > ttlMs) {
        await setCached(key, { processedAt: now, payload, result: undefined }, REDIS_KEYS.WEBHOOK_REPLAY_TTL);
        return true;
      }
      return false; // Duplicate
    }

    await setCached(key, { processedAt: now, payload, result: undefined }, REDIS_KEYS.WEBHOOK_REPLAY_TTL);
    return true;
  },

  /** Mark a webhook as successfully processed */
  async markSuccess(id: string): Promise<void> {
    const client = await getRedisClient();
    if (!client) return;
    
    const key = `${REDIS_KEYS.WEBHOOK_REPLAY}${id}`;
    const existing = await getCached<{ processedAt: number; payload: object; result?: string }>(key);
    if (existing) {
      await setCached(key, { ...existing, result: 'success' }, REDIS_KEYS.WEBHOOK_REPLAY_TTL);
    }
  },

  /** Mark a webhook as failed (allows retry) */
  async markFailed(id: string): Promise<void> {
    const client = await getRedisClient();
    if (!client) return;
    
    const key = `${REDIS_KEYS.WEBHOOK_REPLAY}${id}`;
    const existing = await getCached<{ processedAt: number; payload: object; result?: string }>(key);
    if (existing) {
      await setCached(key, { ...existing, result: 'failed', processedAt: Date.now() }, REDIS_KEYS.WEBHOOK_REPLAY_TTL);
    }
  },

  /** Check if a webhook was already processed successfully */
  async isProcessed(id: string): Promise<boolean> {
    const key = `${REDIS_KEYS.WEBHOOK_REPLAY}${id}`;
    const record = await getCached<{ result?: string }>(key);
    return record?.result === 'success';
  },

  /** Get record for a webhook ID */
  async get(id: string): Promise<{ processedAt: number; payload: object; result?: string } | null | undefined> {
    const key = `${REDIS_KEYS.WEBHOOK_REPLAY}${id}`;
    return getCached(key);
  },

  /** Clean up expired entries (handled by Redis TTL) */
  async cleanup(): Promise<void> {
    // Not needed - Redis TTL handles expiration
  },

  /** Get stats for monitoring */
  async getStats(): Promise<{ total: number; successful: number; failed: number; pending: number }> {
    // Would require SCAN which is heavy - return placeholder
    return { total: 0, successful: 0, failed: 0, pending: 0 };
  },

  /** Shutdown cleanup */
  destroy(): void {
    // No-op - Redis handles cleanup
  }
};

/** Generate idempotency key from webhook payload */
function hashPayload(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

export function generateIdempotencyKey(
  provider: 'senangpay' | 'senangpay-recurring',
  payload: object
): string {
  const keyParts: string[] = [provider];
  const p = payload as Record<string, unknown>;

  if (provider === 'senangpay') {
    const transactionId = p.transactionId as string | undefined;
    const orderId = p.orderId as string | undefined;
    if (transactionId) keyParts.push(`txn:${transactionId}`);
    else if (orderId) keyParts.push(`order:${orderId}`);
    else keyParts.push(`hash:${hashPayload(payload)}`);
  } else if (provider === 'senangpay-recurring') {
    const recurringId = p.recurringId as string | undefined;
    const transactionId = p.transactionId as string | undefined;
    const msg = p.msg as string | undefined;
    const action = p.action as string | undefined;
    const type = p.type as string | undefined;

    if (recurringId) keyParts.push(`recur:${recurringId}`);
    if (transactionId) keyParts.push(`txn:${transactionId}`);
    if (msg) keyParts.push(`msg:${msg}`);
    if (action) keyParts.push(`action:${action}`);
    if (type) keyParts.push(`type:${type}`);
    // If no identifiers found, use payload hash
    if (keyParts.length === 1) {
      keyParts.push(`hash:${hashPayload(payload)}`);
    }
  }

  return keyParts.join('|');
}

/** Middleware wrapper for webhook handlers with replay protection */
export function withWebhookReplayProtection<T extends object>(
  handler: (payload: T) => Promise<{ success: boolean; data?: unknown }>,
  provider: 'senangpay' | 'senangpay-recurring'
) {
  return async (payload: T): Promise<{ success: boolean; data?: unknown; duplicate?: boolean }> => {
    const idempotencyKey = generateIdempotencyKey(provider, payload);
    
    // Try to claim this webhook
    if (!await webhookReplayStore.tryClaim(idempotencyKey, payload)) {
      // Already processed
      const record = await webhookReplayStore.get(idempotencyKey);
      console.log(`[webhook-replay] Duplicate webhook ignored: ${idempotencyKey}`, {
        previousResult: record?.result,
        previousTime: record?.processedAt ? new Date(record.processedAt).toISOString() : undefined,
      });
      return { success: true, duplicate: true, data: record?.payload };
    }

    try {
      const result = await handler(payload);
      if (result.success) {
        await webhookReplayStore.markSuccess(generateIdempotencyKey(provider, payload));
      } else {
        await webhookReplayStore.markFailed(generateIdempotencyKey(provider, payload));
      }
      return result;
    } catch (error) {
      await webhookReplayStore.markFailed(generateIdempotencyKey(provider, payload));
      throw error;
    }
  };
}