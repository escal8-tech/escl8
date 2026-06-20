'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { getFirebaseAuth } from '@/lib/firebaseClient'
import { onAuthStateChanged } from 'firebase/auth'

export type Escal8User = {
  id?: string | null
  email?: string | null
  name?: string | null
  image?: string | null
  role?: string | null
  businessId?: string | null
}

type AuthContextType = {
  user: Escal8User | null
  session: { user: Escal8User } | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  status: 'loading',
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Escal8User | null>(null)
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading')

  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) {
      setStatus('unauthenticated')
      return
    }

    let abortController = new AbortController()

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      abortController.abort()
      abortController = new AbortController()
      const signal = abortController.signal

      if (!fbUser) {
        setUser(null)
        setStatus('unauthenticated')
        return
      }

      // We have a firebase user, let's fetch backend status for role/businessId
      // Note: After sign-out → re-login, Firebase's onAuthStateChanged fires
      // BEFORE the login page finishes exchanging the Firebase token for a JWT
      // cookie via POST /api/auth/token. This causes /api/auth/status to return
      // 401 because the cookie doesn't exist yet. We retry a few times with
      // backoff to give the login page time to establish the session.
      try {
        let response: Response | null = null
        const maxRetries = 4
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (signal.aborted) return
          response = await fetch('/api/auth/status', {
            cache: 'no-store',
            credentials: 'include',
            signal,
          })
          if (response.ok || response.status !== 401) break
          // 401 — cookie probably not set yet; wait and retry
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
          }
        }
        if (!response || !response.ok) throw new Error('Failed to fetch status')
        const data = await response.json()
        
        if (signal.aborted) return

        const escal8User: Escal8User = {
          id: data.user?.id || fbUser.uid,
          email: fbUser.email,
          name: fbUser.displayName,
          image: fbUser.photoURL,
          role: data.user?.role,
          businessId: data.user?.businessId,
        }
        
        setUser(escal8User)
        setStatus('authenticated')
      } catch (e: unknown) {
        if (e && typeof e === 'object' && 'name' in e && e.name === 'AbortError') return
        console.error('Failed to resolve Escal8 user context', e)
        // Fallback to basic FB user, but do not set status to authenticated
        // if the backend rejected the session.
        setUser({
          id: fbUser.uid,
          email: fbUser.email,
          name: fbUser.displayName,
          image: fbUser.photoURL,
        })
        setStatus('unauthenticated')
      }
    })

    return () => {
      abortController.abort()
      unsub()
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, session: user ? { user } : null, status }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

/**
 * Compatibility hook to drop-in replace next-auth useSession
 */
export function useSession() {
  const { session, status } = useAuth()
  return { data: session, status }
}