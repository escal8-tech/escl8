import {jwtVerify, type JWTPayload} from 'jose';

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is missing');
  }
  return new TextEncoder().encode(process.env.JWT_SECRET);
};
const JWT_ISSUER = 'escal8';
const JWT_AUDIENCE = 'escal8-apps';

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
  businessId: string | null; // Added for middleware to use directly
}

export interface Escal8JWTPayloadBase extends JWTPayload {
  sub: string;
  email: string;
  suiteTenantId: string;
  userId: string | null;
}

export interface Escal8JWTAccessPayload extends Escal8JWTPayloadBase {
  type: 'access';
  subscription: SubscriptionClaims;
}

export interface Escal8JWTRefreshPayload extends Escal8JWTPayloadBase {
  type: 'refresh';
  subscription?: undefined;
}

export type Escal8JWTPayload = Escal8JWTAccessPayload | Escal8JWTRefreshPayload;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export type SuiteProductModule = 'agent' | 'reservation';

/**
 * Verify and decode access token (Edge compatible - no Redis blacklist check)
 */
export async function verifyAccessToken(token: string): Promise<Escal8JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    
    if (payload.type !== 'access') {
      return null;
    }
    
    return payload as unknown as Escal8JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Verify and decode refresh token (Edge compatible - no Redis blacklist check)
 */
export async function verifyRefreshToken(token: string): Promise<Escal8JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    
    if (typeof payload.type !== 'string' || payload.type !== 'refresh') {
      return null;
    }
    
    return payload as unknown as Escal8JWTPayload;
  } catch {
    return null;
  }
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
export function tokenHasFeature(payload: Escal8JWTAccessPayload, featureKey: string): boolean {
  return Boolean(payload.subscription?.features?.[featureKey]);
}

/**
 * Get limit from token
 */
export function tokenGetLimit(payload: Escal8JWTAccessPayload, limitKey: string): number | null {
  const value = payload.subscription?.limits?.[limitKey];
  return typeof value === 'number' ? value : null;
}

/**
 * Get workspace mode from token
 */
export function tokenGetWorkspaceMode(payload: Escal8JWTAccessPayload): 'full' | 'readonly' | 'blocked' {
  return payload.subscription?.workspaceMode ?? 'blocked';
}

/**
 * Check if token has module access
 */
export function tokenHasModuleAccess(payload: Escal8JWTAccessPayload, module: SuiteProductModule): boolean {
  if (module === 'agent') {
    return payload.subscription?.grantsAgent === true || payload.subscription?.isSpecialGrant === true;
  }
  return payload.subscription?.grantsReservation === true || payload.subscription?.isSpecialGrant === true;
}

/**
 * Get hotelId from token (for middleware)
 */
export function tokenGetBusinessId(payload: Escal8JWTAccessPayload): string | null {
  return payload.subscription?.businessId ?? null;
}
