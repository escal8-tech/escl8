/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { eq, lte, sql } from "drizzle-orm";
import { operationThrottles } from "@/../drizzle/schema";
import { db } from "@/server/db/client";

type TimestampValue = Date | string | null | undefined;

export type OperationThrottleRule = {
  businessId: string;
  bucket: string;
  scope: string;
  max: number;
  windowMs: number;
  message?: string;
};

type OperationThrottleResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

let throttleSweepsSinceCleanup = 0;

function normalizeTimestamp(value: TimestampValue): string | null {
  if (!value) return null;
  const normalized = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(normalized.getTime())) return null;
  return normalized.toISOString();
}

export function assertExpectedUpdatedAt(params: {
  entityLabel: string;
  expectedUpdatedAt?: TimestampValue;
  actualUpdatedAt?: TimestampValue;
}) {
  const expectedIso = normalizeTimestamp(params.expectedUpdatedAt);
  if (!expectedIso) return;

  const actualIso = normalizeTimestamp(params.actualUpdatedAt);
  if (actualIso === expectedIso) return;

  throw new TRPCError({
    code: "CONFLICT",
    message: `This ${params.entityLabel} was updated by another staff member. Refresh and try again.`,
  });
}

async function maybeCleanupExpiredThrottles() {
  throttleSweepsSinceCleanup += 1;
  if (throttleSweepsSinceCleanup < 200) return;
  throttleSweepsSinceCleanup = 0;
  await db.delete(operationThrottles).where(lte(operationThrottles.resetAt, new Date()));
}

export async function consumeOperationThrottle(tx: any, rule: OperationThrottleRule): Promise<OperationThrottleResult> {
  const scopedKey = `${rule.bucket}:${rule.scope}`;
  const now = new Date();
  const nextResetAt = new Date(now.getTime() + rule.windowMs);

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scopedKey}))`);

  const [existing] = await tx
    .select({
      scopeKey: operationThrottles.scopeKey,
      hitCount: operationThrottles.hitCount,
      resetAt: operationThrottles.resetAt,
    })
    .from(operationThrottles)
    .where(eq(operationThrottles.scopeKey, scopedKey))
    .limit(1);

  if (!existing || new Date(existing.resetAt).getTime() <= now.getTime()) {
    if (tx === db) {
      await maybeCleanupExpiredThrottles();
    }
    await tx
      .insert(operationThrottles)
      .values({
        scopeKey: scopedKey,
        businessId: rule.businessId,
        bucket: rule.bucket,
        hitCount: 1,
        resetAt: nextResetAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: operationThrottles.scopeKey,
        set: {
          businessId: rule.businessId,
          bucket: rule.bucket,
          hitCount: 1,
          resetAt: nextResetAt,
          updatedAt: now,
        },
      });

    return {
      ok: true,
      limit: rule.max,
      remaining: Math.max(0, rule.max - 1),
      resetAt: nextResetAt,
      retryAfterSeconds: Math.max(1, Math.ceil(rule.windowMs / 1000)),
    };
  }

  const currentHits = Number(existing.hitCount ?? 0);
  if (currentHits >= rule.max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((new Date(existing.resetAt).getTime() - now.getTime()) / 1000),
    );
    return {
      ok: false,
      limit: rule.max,
      remaining: 0,
      resetAt: new Date(existing.resetAt),
      retryAfterSeconds,
    };
  }

  const [updated] = await tx
    .update(operationThrottles)
    .set({
      hitCount: currentHits + 1,
      updatedAt: now,
    })
    .where(eq(operationThrottles.scopeKey, scopedKey))
    .returning({
      hitCount: operationThrottles.hitCount,
      resetAt: operationThrottles.resetAt,
    });

  return {
    ok: true,
    limit: rule.max,
    remaining: Math.max(0, rule.max - Number(updated?.hitCount ?? currentHits + 1)),
    resetAt: new Date(updated?.resetAt ?? existing.resetAt),
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((new Date(updated?.resetAt ?? existing.resetAt).getTime() - now.getTime()) / 1000),
    ),
  };
}

export async function assertOperationThrottle(tx: any, rule: OperationThrottleRule) {
  const result = await consumeOperationThrottle(tx, rule);
  if (result.ok) return result;
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: rule.message ?? "Too many requests. Please wait a moment and try again.",
  });
}

export function getStaffActorKey(ctx: {
  businessId: string;
  userId?: string | null;
  firebaseUid?: string | null;
  userEmail?: string | null;
}) {
  return ctx.userId ?? ctx.firebaseUid ?? ctx.userEmail ?? "unknown_staff";
}
