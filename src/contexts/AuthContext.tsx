'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { tokenHandler, type Escal8JWTPayload, type SubscriptionClaims } from '@/lib/jwt-client'

export interface AuthContextValue {
  // Auth state
  isAuthenticated: boolean
  firebaseUser: { uid: string; email: string } | null
  accessToken: string | null
  payload: Escal8JWTPayload | null
  subscription: SubscriptionClaims | null
  isLoading: boolean
  error: string | null
  
  // Actions
  signInWithFirebaseToken: (idToken: string, module?: 'agent' | 'reservation') => Promise<void>
  signOut: () => Promise<void>
  refreshAccessToken: () => Promise<void>
  updateSubscription: (subscription: SubscriptionClaims | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [firebaseUser, setFirebaseUser] = useState<{ uid: string; email: string } | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [payload, setPayload] = useState<Escal8JWTPayload | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionClaims | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshTimer, setRefreshTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  // Use ref to avoid stale closure in scheduleTokenRefresh
  const refreshAccessTokenRef = useRef<(() => Promise<void>) | null>(null)

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
        await refreshAccessTokenRef.current?.()
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
      
      // Server sets tokens via httpOnly cookies and returns only { success, expiresIn, tokenType }
      const { expiresIn, success } = await tokenResponse.json()
      
      if (!success) {
        throw new Error('Token exchange failed')
      }
      
      // Fetch verified payload using the cookie session + Authorization header
      const verifyResponse = await fetch('/api/auth/token', {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      })
      if (!verifyResponse.ok) {
        throw new Error('Token verification failed after sign-in')
      }
      const { payload: jwtPayload } = await verifyResponse.json()
      
      setPayload(jwtPayload)
      setSubscription(jwtPayload.subscription as SubscriptionClaims)
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

  const signOut = useCallback(async () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    
    // Invalidate tokens server-side (blacklists tokens and clears cookies)
    try {
      await fetch('/api/auth/token', {
        method: 'DELETE',
        credentials: 'include',
      })
    } catch (err) {
      console.error('Server sign-out failed:', err)
      // Continue with local cleanup even if server call fails
    }
    
    tokenHandler.clearTokens()
    setIsAuthenticated(false)
    setFirebaseUser(null)
    setAccessToken(null)
    setPayload(null)
    setSubscription(null)
    setError(null)
  }, [refreshTimer])

  // Add signOut to deps for refreshAccessToken - signOut is now declared above
  const refreshAccessToken = useCallback(async () => {
    const refreshToken = tokenHandler.getRefreshToken()
    if (!refreshToken) {
      await signOut()
      return
    }
    
    try {
      const response = await fetch('/api/auth/token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      })
      
      if (!response.ok) {
        throw new Error('Token refresh failed')
      }
      
      // Server rotates cookies and returns only { success, expiresIn, tokenType }
      const { expiresIn } = await response.json()
      scheduleTokenRefresh(expiresIn)
      
    } catch (err) {
      console.error('Token refresh failed:', err)
      await signOut()
    }
  }, [scheduleTokenRefresh, signOut])

  const updateSubscription = useCallback((sub: SubscriptionClaims | null) => {
    setSubscription(sub)
  }, [])

  // Update ref when refreshAccessToken changes (placed here to avoid stale closure)
  useEffect(() => {
    refreshAccessTokenRef.current = refreshAccessToken
  }, [refreshAccessToken])

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
            setSubscription(jwtPayload.subscription as SubscriptionClaims)
            setIsAuthenticated(true)

            // Schedule refresh based on token expiry
            const exp = jwtPayload.exp * 1000
            const expiresIn = Math.max(Math.floor((exp - Date.now()) / 1000), 1)
            scheduleTokenRefresh(expiresIn)
            setIsLoading(false)
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