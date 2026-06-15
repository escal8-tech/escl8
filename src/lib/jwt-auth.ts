import {SignJWT, jwtVerify, type JWTPayload} from 'jose';
import {getTenantModuleAccess, type TenantModuleAccess, type SuiteProductModule} from '@/server/control/access';
import {getRedisClient, existsCached, setCached} from '@/lib/redis';
import {REDIS_KEYS} from '@/lib/redis';

const JWT_ISSUER = 'escal8';
const JWT_AUDIENCE = 'escal8-apps';
const ACCESS_TOKEN_TTL='***'; // 15 minutes
const REFRESH_TOKEN_TTL='***'; // 7 days

function getJWTSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required for production. Set a secure 32+ character secret.')
  }
  return new TextEncoder().encode(secret)
}

export interface SubscriptionClaims {
  suiteTenantId: string;
  planCode: string | null;
  planName: string | null;
  status: string;
  grantKind: string | null;
  grantsAgent: boolean;
  grantsReservation: boolean;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  workspaceMode: 'full' | 'readonly' | 'blocked';
  isSpecialGrant: boolean;
}

export interface Escal8JWTPayload extends JWTPayload {
  sub: string;           // firebaseUid
  email: string;
  suiteTenantId: string;
  subscription?: SubscriptionClaims; // Optional for refresh tokens
  type: 'access' | 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

/**
 * Generate short-lived access token with subscription claims
 */
export async function generateAccessToken(
  firebaseUid: string,
  email: string,
  suiteTenantId: string,
  module: SuiteProductModule = 'reservation'
): Promise<string> {
  const tenantAccess = await getTenantModuleAccess(suiteTenantId, module);
  
  // The grantsAgent/grantsReservation are checked via the module access itself
  const grantsAgent = module === 'agent' && tenantAccess.allowed;
  const grantsReservation = module === 'reservation' && tenantAccess.allowed;
  
  const subscriptionClaims: SubscriptionClaims = {
    suiteTenantId, // tenantAccess doesn't have suiteTenantId, pass the one we have
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
  };

  const payload: Escal8JWTPayload = {
    sub: firebaseUid,
    email,
    suiteTenantId,
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
    .sign(getJWTSecret());
}

/**
 * Generate long-lived refresh token
 */
export async function generateRefreshToken(
  firebaseUid: string,
  email: string,
  suiteTenantId: string
): Promise<string> {
  const payload = {
    sub: firebaseUid,
    email,
    suiteTenantId,
    // subscription field omitted for refresh tokens
    type: 'refresh' as const,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
  };

  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .setSubject(firebaseUid)
    .sign(getJWTSecret());
}

/**
 * Generate both access and refresh tokens
 */
export async function generateTokenPair(
  firebaseUid: string,
  email: string,
  suiteTenantId: string,
  module: SuiteProductModule = 'reservation'
): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken(firebaseUid, email, suiteTenantId, module),
    generateRefreshToken(firebaseUid, email, suiteTenantId),
  ]);

  // Parse TTL to seconds
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
      const blacklisted = await existsCached(`${REDIS_KEYS.TOKEN_BLACKLIST}${token}`);
      if (blacklisted) {
        return null; // Token is blacklisted
      }
    }

    const { payload } = await jwtVerify(token, getJWTSecret(), {
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
    // Check token blacklist first
    const client = await getRedisClient();
    if (client) {
      const blacklisted = await existsCached(`${REDIS_KEYS.TOKEN_BLACKLIST}${token}`);
      if (blacklisted) {
        return null; // Token is blacklisted
      }
    }

    const { payload } = await jwtVerify(token, getJWTSecret(), {
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
export async function refreshAccessToken(refreshToken: string, module: SuiteProductModule = 'reservation'): Promise<TokenPair | null> {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) return null;

  return generateTokenPair(payload.sub, payload.email, payload.suiteTenantId, module);
}

/**
 * Extract token from Authorization header
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/**
 * Middleware to validate access token and attach subscription claims
 */
export async function validateAuthToken(request: Request): Promise<{
  valid: boolean;
  payload?: Escal8JWTPayload;
  error?: string;
}> {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token) {
    return { valid: false, error: 'Missing authorization token' };
  }

  const payload = await verifyAccessToken(token);
  if (!payload) {
    return { valid: false, error: 'Invalid or expired token' };
  }

  if (payload.type !== 'access') {
    return { valid: false, error: 'Wrong token type' };
  }

  return { valid: true, payload };
}

/**
 * Check if token has specific feature
 */
export function tokenHasFeature(payload: Escal8JWTPayload, featureKey: string): boolean {
  return Boolean(payload.subscription?.features?.[featureKey]);
}

/**
 * Get limit from token
 */
export function tokenGetLimit(payload: Escal8JWTPayload, limitKey: string): number | null {
  const value = payload.subscription?.limits?.[limitKey];
  return typeof value === 'number' ? value : null;
}

/**
 * Get workspace mode from token
 */
export function tokenGetWorkspaceMode(payload: Escal8JWTPayload): 'full' | 'readonly' | 'blocked' {
  return payload.subscription?.workspaceMode ?? 'blocked';
}

/**
 * Check if token has module access
 */
export function tokenHasModuleAccess(payload: Escal8JWTPayload, module: SuiteProductModule): boolean {
  if (module === 'agent') {
    return payload.subscription?.grantsAgent === true || payload.subscription?.isSpecialGrant === true;
  }
  return payload.subscription?.grantsReservation === true || payload.subscription?.isSpecialGrant === true;
}

/**
 * Blacklist a token (for logout/revocation)
 * Adds token to Redis blacklist with TTL based on token expiry
 */
export async function blacklistToken(token: string): Promise<void> {
  const client = await getRedisClient();
  if (client && token) {
    // Try to decode token to get expiry
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
      // If we can't decode, blacklist with max TTL (7 days)
      await setCached(`${REDIS_KEYS.TOKEN_BLACKLIST}${token}`, true, REDIS_KEYS.TOKEN_BLACKLIST_TTL);
    }
  }
}