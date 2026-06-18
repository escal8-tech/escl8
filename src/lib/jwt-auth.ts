import {SignJWT, jwtVerify, type JWTPayload} from 'jose';
import {getTenantModuleAccess, type TenantModuleAccess, type SuiteProductModule} from '@/server/control/access';
import {getRedisClient, getCached, setCached} from '@/lib/redis';
import {REDIS_KEYS} from '@/lib/redis';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-in-production-min-32-chars!!'
);
const JWT_ISSUER = 'escal8';
const JWT_AUDIENCE = 'escal8-apps';
const ACCESS_TOKEN_TTL = '15m'; // 15 minutes
const REFRESH_TOKEN_TTL = '7d'; // 7 days

// Cache key for suiteTenantId -> hotelId mapping
const HOTEL_ID_CACHE_KEY = 'suite_tenant_hotel_id:';
const HOTEL_ID_CACHE_TTL = 3600; // 1 hour

// Sentinel object to distinguish "cached null" from "cache miss"
const NULL_HOTEL_ID = Symbol('NULL_HOTEL_ID');

export type {
  SubscriptionClaims,
  Escal8JWTPayload,
  TokenPair
} from './jwt-edge';

import type { SubscriptionClaims, Escal8JWTPayload, TokenPair } from './jwt-edge';

/**
 * Get businessId from suiteTenantId with Redis caching
 */
async function getBusinessIdFromSuiteTenantId(suiteTenantId: string): Promise<string | null> {
  const cacheKey = `${HOTEL_ID_CACHE_KEY}${suiteTenantId}`;

  // Try cache first
  const cached = await getCached<string | typeof NULL_HOTEL_ID>(cacheKey);
  if (cached !== undefined) {
    // Cache hit - check if it's our sentinel for "no business found"
    return cached === NULL_HOTEL_ID ? null : cached;
  }

  // Look up from DB
  try {
    const { queryRows } = await import('@/lib/db');
    const rows = await queryRows<{ id: string }>(
      'agent',
      `SELECT id FROM businesses WHERE suite_tenant_id = $1 AND is_active = true LIMIT 1`,
      [suiteTenantId]
    );

    const businessId = rows[0]?.id ?? null;

    // Cache the result using sentinel for null
    await setCached(cacheKey, businessId ?? NULL_HOTEL_ID, HOTEL_ID_CACHE_TTL);

    return businessId;
  } catch {
    // Cache null result to prevent repeated lookups
    await setCached(cacheKey, NULL_HOTEL_ID, HOTEL_ID_CACHE_TTL);
    return null;
  }
}

/**
 * Get user's businessId constrained by suiteTenantId
 * Returns null if user has no business assigned to this tenant
 */
async function getUserInfo(firebaseUid: string, suiteTenantId: string): Promise<{ businessId: string | null, userId: string | null }> {
  const { db } = await import('@/server/db/client');
  const { users, businesses } = await import('@/../drizzle/schema');
  const { eq, and } = await import('drizzle-orm');

  const rows = await db
    .select({ businessId: users.businessId, userId: users.id })
    .from(users)
    .innerJoin(businesses, eq(users.businessId, businesses.id))
    .where(and(eq(users.firebaseUid, firebaseUid), eq(businesses.suiteTenantId, suiteTenantId)))
    .limit(1);

  return { businessId: rows[0]?.businessId ?? null, userId: rows[0]?.userId ?? null };
}

/**
 * Generate short-lived access token with subscription claims
 */
export async function generateAccessToken(
  firebaseUid: string,
  email: string,
  suiteTenantId: string,
  module: SuiteProductModule = 'agent',
  businessId?: string | null
): Promise<string> {
  const tenantAccess = await getTenantModuleAccess(suiteTenantId, module);

  // Resolve businessId:
  // - If explicitly provided (not undefined), validate it belongs to this tenant
  // - If undefined (not provided), look up user's business for this tenant
  // - If null (explicitly unassigned), keep as null - don't fall back
  let resolvedBusinessId: string | null;
  let resolvedUserId: string | null = null;

  if (businessId !== undefined) {
    // businessId was explicitly provided (could be string or null)
    if (businessId !== null) {
      // Validate the businessId belongs to this tenant
      const { db } = await import('@/server/db/client');
      const { businesses } = await import('@/../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const rows = await db
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.id, businessId), eq(businesses.suiteTenantId, suiteTenantId)))
        .limit(1);

      if (rows.length === 0) {
        // Provided businessId doesn't belong to this tenant - treat as unassigned
        resolvedBusinessId = null;
      } else {
        resolvedBusinessId = businessId;
      }
    } else {
      // Explicitly null - user has no business assigned
      resolvedBusinessId = null;
    }
  } else {
    // Not provided - look up user's business for this tenant
    const userInfo = await getUserInfo(firebaseUid, suiteTenantId);
    resolvedBusinessId = userInfo.businessId;
    resolvedUserId = userInfo.userId;
    // If still null, fall back to first business for tenant
    if (resolvedBusinessId === null) {
      resolvedBusinessId = await getBusinessIdFromSuiteTenantId(suiteTenantId);
    }
  }

  // If userId is still missing, try to get it
  if (!resolvedUserId) {
    const { db } = await import('@/server/db/client');
    const { users } = await import('@/../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
    resolvedUserId = rows[0]?.id ?? null;
  }
  const grantsAgent = module === 'agent' && tenantAccess.allowed;
  const grantsReservation = module === 'reservation' && tenantAccess.allowed;

  const subscriptionClaims: SubscriptionClaims = {
    suiteTenantId,
    planCode: tenantAccess.planCode,
    planName: tenantAccess.planName,
    status: tenantAccess.subscriptionStatus ?? 'none',
    grantKind: tenantAccess.grantKind,
    grantsAgent,
    grantsReservation,
    features: tenantAccess.features ?? {},
    limits: Object.fromEntries(
      Object.entries(tenantAccess.limits ?? {}).filter(([, v]) => typeof v === 'number')
    ) as Record<string, number>,
    workspaceMode: tenantAccess.workspaceMode,
    isSpecialGrant: tenantAccess.isGrandfathered || (tenantAccess.grantKind === 'demo' || tenantAccess.grantKind === 'partner'),
    businessId: resolvedBusinessId,
  };

  const payload: Escal8JWTPayload = {
    sub: firebaseUid,
    email,
    suiteTenantId,
    userId: resolvedUserId,
    subscription: subscriptionClaims,
    type: 'access',
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
  };

  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .setSubject(firebaseUid)
    .sign(JWT_SECRET);
}

/**
 * Generate long-lived refresh token
 */
export async function generateRefreshToken(
  firebaseUid: string,
  email: string,
  suiteTenantId: string,
  userId: string | null
): Promise<string> {
  const payload: Escal8JWTPayload = {
    sub: firebaseUid,
    email,
    suiteTenantId,
    userId,
    subscription: null as any, // Not used in refresh token
    type: 'refresh',
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
  };

  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .setSubject(firebaseUid)
    .sign(JWT_SECRET);
}

/**
 * Generate both access and refresh tokens
 */
export async function generateTokenPair(
  firebaseUid: string,
  email: string,
  suiteTenantId: string,
  module: SuiteProductModule = 'agent',
  businessId?: string | null
) {
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken(firebaseUid, email, suiteTenantId, module, businessId),
    generateRefreshToken(firebaseUid, email, suiteTenantId, null), // we don't strictly need userId in refresh token since we'll refetch it
  ]);

  const ttlMatch = ACCESS_TOKEN_TTL.match(/^(\d+)([mhd])$/);
  const expiresIn = ttlMatch
    ? parseInt(ttlMatch[1]) * ({ m: 60, h: 3600, d: 86400 }[ttlMatch[2] as 'm' | 'h' | 'd'] || 60)
    : 900;

  return { accessToken, refreshToken, expiresIn };
}

/**
 * Verify and decode access token
 */
export async function verifyAccessToken(token: string): Promise<Escal8JWTPayload | null> {
  try {
    // Check token blacklist first
    const client = await getRedisClient();
    if (client) {
      const blacklisted = await getCached(`${REDIS_KEYS.TOKEN_BLACKLIST}${token}`);
      if (blacklisted) {
        return null;
      }
    }

    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as Escal8JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Verify and decode refresh token
 */
export async function verifyRefreshToken(token: string): Promise<Escal8JWTPayload | null> {
  try {
    const client = await getRedisClient();
    if (client) {
      const blacklisted = await getCached(`${REDIS_KEYS.TOKEN_BLACKLIST}${token}`);
      if (blacklisted) {
        return null;
      }
    }

    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (payload.type !== 'refresh') return null;
    return payload as unknown as Escal8JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string, module: SuiteProductModule = 'agent'): Promise<TokenPair | null> {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) return null;

  // Look up user's current businessId constrained by suiteTenantId from token
  const userInfo = await getUserInfo(payload.sub, payload.suiteTenantId);

  return generateTokenPair(payload.sub, payload.email, payload.suiteTenantId, module, userInfo.businessId);
}

export {
  extractBearerToken,
  validateAuthToken,
  tokenHasFeature,
  tokenGetLimit,
  tokenGetWorkspaceMode,
  tokenHasModuleAccess,
  tokenGetBusinessId
} from './jwt-edge';

/**
 * Blacklist a token (for logout/revocation)
 */
export async function blacklistToken(token: string): Promise<void> {
  const client = await getRedisClient();
  if (client && token) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        const exp = payload.exp;
        if (exp) {
          const ttl = exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            await setCached(`${REDIS_KEYS.TOKEN_BLACKLIST}${token}`, true, ttl);
          }
        }
      }
    } catch {
      await setCached(`${REDIS_KEYS.TOKEN_BLACKLIST}${token}`, true, REDIS_KEYS.TOKEN_BLACKLIST_TTL);
    }
  }
}