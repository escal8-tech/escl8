/**
 * Client-side JWT Token Handler
 * Handles secure storage and management of access/refresh tokens
 */

interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

const ACCESS_TOKEN_KEY='escal8_access_token'
const REFRESH_TOKEN_KEY='escal8_refresh_token'
const EXPIRES_AT_KEY = 'escal8_expires_at'

/**
 * Secure token storage using httpOnly cookies would be better for production.
 * This implementation uses localStorage for simplicity but should be upgraded.
 */
export const tokenHandler = {
  // Access token
  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(ACCESS_TOKEN_KEY)
  },

  setAccessToken(token: string): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(ACCESS_TOKEN_KEY, token)
  },

  // Refresh token
  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(REFRESH_TOKEN_KEY)
  },

  setRefreshToken(token: string): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(REFRESH_TOKEN_KEY, token)
  },

  // Token pair
  setTokens(accessToken: string, refreshToken: string): void {
    this.setAccessToken(accessToken)
    this.setRefreshToken(refreshToken)
  },

  // Expiry
  getExpiresAt(): number | null {
    if (typeof window === 'undefined') return null
    const stored = localStorage.getItem(EXPIRES_AT_KEY)
    return stored ? parseInt(stored, 10) : null
  },

  setExpiresAt(expiresAt: number): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt))
  },

  // Clear all
  clearTokens(): void {
    if (typeof window === 'undefined') return
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(EXPIRES_AT_KEY)
  },

  // Check if token is expired or about to expire
  isTokenExpired(bufferMs: number = 30000): boolean {
    const expiresAt = this.getExpiresAt()
    if (!expiresAt) return true
    return Date.now() + bufferMs >= expiresAt
  },

  // Get token remaining time in seconds
  getTokenRemainingTime(): number {
    const expiresAt = this.getExpiresAt()
    if (!expiresAt) return 0
    return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  }
}

export interface Escal8JWTPayload {
  sub: string
  email: string
  suiteTenantId: string
  subscription?: SubscriptionClaims
  type: 'access' | 'refresh'
  exp: number
  iat: number
  iss: string
  aud: string
}

export interface SubscriptionClaims {
  suiteTenantId: string
  planCode: string | null
  planName: string | null
  status: string
  grantKind: string | null
  grantsAgent: boolean
  grantsReservation: boolean
  workspaceMode: 'full' | 'readonly' | 'blocked'
  isSpecialGrant: boolean
  features: Record<string, boolean>
  limits: Record<string, number>
}

/**
 * Decode JWT payload without verification (client-side only)
 */
export function decodeJwtPayload<T = Escal8JWTPayload>(token: string): T | null {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    return JSON.parse(jsonPayload) as T
  } catch {
    return null
  }
}

/**
 * Check if access token is valid (not expired)
 */
export function isAccessTokenValid(): boolean {
  return !tokenHandler.isTokenExpired()
}

/**
 * Get subscription claims from current token
 */
export function getSubscriptionFromToken(): SubscriptionClaims | null {
  const token = tokenHandler.getAccessToken()
  if (!token) return null
  
  return decodeJwtPayload(token)?.subscription ?? null
}