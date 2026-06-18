'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import { useState } from 'react'
import superjson from 'superjson'
import type { AppRouter } from '@/server/routers'

export const trpc = createTRPCReact<AppRouter>()

function getBaseUrl() {
  if (typeof window !== 'undefined') return ''
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  return 'https://app.escal8.tech'
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          maxURLLength: 3500,
          fetch: async (url, options) => {
            const fetchOptions: RequestInit = { ...options, credentials: 'include' }
            let res = await fetch(url, fetchOptions)
            if (res.status === 401) {
              try {
                const refreshRes = await fetch(`${getBaseUrl()}/api/auth/refresh`, {
                  method: 'PUT',
                  credentials: 'include',
                })
                if (refreshRes.ok) {
                  res = await fetch(url, fetchOptions)
                } else if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/login')) {
                  window.location.href = '/auth/login?redirect=' + encodeURIComponent(window.location.pathname)
                  await new Promise(() => {}) 
                }
              } catch (e) {
                if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/login')) {
                  window.location.href = '/auth/login?redirect=' + encodeURIComponent(window.location.pathname)
                  await new Promise(() => {}) 
                }
              }
            } else if (res.status === 403 && typeof window !== 'undefined') {
              window.location.href = '/subscription?reason=inactive_subscription&redirect=' + encodeURIComponent(window.location.pathname)
            }
            return res
          }
        })
      ]
    })
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}
