'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { tokenHandler, type Escal8JWTPayload, type SubscriptionClaims } from '@/lib/jwt-client'

interface SubscriptionClaimsClient extends SubscriptionClaims {
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

export interface AuthContextValue {
  // Auth state
  isAuthenticated: boolean
  firebaseUser: { uid: string; email: string } | null
  accessToken: string | null
  payload: Escal8JWTPayload | null
  subscription: SubscriptionClaimsClient | null
  isLoading: boolean
  error: string | null
  
  // Actions
  signInWithFirebaseToken: (idToken: string, module?: 'agent' | 'reservation') => Promise<void>
  signOut: () => Promise<void>
  refreshAccessToken: () => Promise<void>
  updateSubscription: (subscription: SubscriptionClaimsClient | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [firebaseUser, setFirebaseUser] = useState<{ uid: string; email: string } | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [payload, setPayload] = useState<Escal8JWTPayload | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionClaimsClient | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshTimer, setRefreshTimer] = useState<NodeJS.Timeout | null>(null)

  // Clear refresh timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [refreshTimer])

  // Schedule token refresh
  const scheduleTokenRefresh = useCallback((expiresIn: number) => {
    if (refreshTimer) clearTimeout(refreshTimer)
    
    // Refresh 30 seconds before expiry
    const refreshAt = Math.max((expiresIn - 30) * 1000, 1000)
    
    const timer = setTimeout(async () => {
      try {
        await refreshAccessToken()
      } catch (err) {
        console.error('Auto token refresh failed:', err)
      }
    }, refreshAt)
    
    setRefreshTimer(timer)
  }, [refreshTimer])

  const signInWithFirebaseToken = useCallback(async (idToken: string, module: 'agent' | 'reservation' = 'reservation') => {
    setIsLoading(true)
    setError(null)
    
    try {
      // Verify Firebase token first to get user info
      const response = await fetch('/api/auth/verify', {
        headers: { authorization: `Bearer ${idToken}` }
      })
      
      if (!response.ok) {
        throw new Error('Invalid Firebase token')
      }
      
      const { payload: firebasePayload } = await response.json()
      
      // Exchange for Escal8 JWT pair
      const tokenResponse = await fetch('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, module })
      })
      
      if (!tokenResponse.ok) {
        const err = await tokenResponse.json()
        throw new Error(err.error || 'Token exchange failed')
      }
      
      const { accessToken, refreshToken, expiresIn, payload: jwtPayload } = await tokenResponse.json()
      
      // Store tokens
      tokenHandler.setTokens(accessToken, refreshToken)
      setAccessToken(accessToken)
      setPayload(jwtPayload)
      setFirebaseUser({ uid: firebasePayload.sub, email: firebasePayload.email })
      setIsAuthenticated(true)
      
      // Schedule auto-refresh
      scheduleTokenRefresh(expiresIn)
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed'
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [scheduleTokenRefresh])

  const refreshAccessToken = useCallback(async () => {
    const refreshToken = tokenHandler.getRefreshToken()
    if (!refreshToken) {
      await signOut()
      return
    }
    
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      })
      
      if (!response.ok) {
        throw new Error('Token refresh failed')
      }
      
      const { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn, payload: newPayload } = await response.json()
      
      tokenHandler.setTokens(newAccessToken, newRefreshToken)
      setAccessToken(newAccessToken)
      setPayload(newPayload)
      scheduleTokenRefresh(expiresIn)
      
    } catch (err) {
      console.error('Token refresh failed:', err)
      await signOut()
    }
  }, [scheduleTokenRefresh])

  const signOut = useCallback(async () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    tokenHandler.clearTokens()
    setIsAuthenticated(false)
    setFirebaseUser(null)
    setAccessToken(null)
    setPayload(null)
    setSubscription(null)
    setError(null)
  }, [refreshTimer])

  const updateSubscription = useCallback((sub: SubscriptionClaimsClient | null) => {
    setSubscription(sub)
  }, [])

  // Check for stored tokens on mount
  useEffect(() => {
    const initAuth = async () => {
      const accessToken = tokenHandler.getAccessToken()
      const refreshToken = tokenHandler.getRefreshToken()
      
      if (accessToken && refreshToken) {
        try {
          // Validate existing token
          const response = await fetch('/api/auth/verify', {
            headers: { authorization: `Bearer ${accessToken}` }
          })
          
          if (response.ok) {
            const { payload: jwtPayload } = await response.json()
            setPayload(jwtPayload)
            setSubscription(jwtPayload.subscription as SubscriptionClaimsClient)
            setIsAuthenticated(true)
            
            // Schedule refresh based on token expiry
            const exp = jwtPayload.exp * 1000
            const expiresIn = Math.max(Math.floor((exp - Date.now()) / 1000), 1)
            scheduleTokenRefresh(expiresIn)
            return
          }
        } catch {
          // Token invalid, try refresh
        }
        
        // Try refresh token
        try {
          await refreshAccessToken()
        } catch {
          tokenHandler.clearTokens()
        }
      }
      
      setIsLoading(false)
    }
    
    initAuth()
  }, [scheduleTokenRefresh, refreshAccessToken])

  const value: AuthContextValue = {
    isAuthenticated,
    firebaseUser,
    accessToken,
    payload,
    subscription,
    isLoading,
    error,
    signInWithFirebaseToken,
    signOut,
    refreshAccessToken,
    updateSubscription,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

// Helper hook for subscription features
export function useSubscriptionAccess() {
  const { subscription, payload } = useAuth()
  
  const hasFeature = useCallback((featureKey: string) => {
    if (!subscription?.features) return false
    return Boolean(subscription.features[featureKey])
  }, [subscription])
  
  const getLimit = useCallback((limitKey: string) => {
    if (!subscription?.limits) return null
    const value = subscription.limits[limitKey]
    return typeof value === 'number' ? value : null
  }, [subscription])
  
  const hasModuleAccess = useCallback((module: 'agent' | 'reservation') => {
    if (module === 'agent') {
      return payload?.subscription?.grantsAgent === true || subscription?.isSpecialGrant === true
    }
    return payload?.subscription?.grantsReservation === true || subscription?.isSpecialGrant === true
  }, [payload, subscription])
  
  const getWorkspaceMode = useCallback(() => {
    return subscription?.workspaceMode || payload?.subscription?.workspaceMode || 'blocked'
  }, [subscription, payload])
  
  return { hasFeature, getLimit, hasModuleAccess, getWorkspaceMode, subscription, payload }
}