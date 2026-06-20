import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/server/db/client'
import { businesses, users } from '@/../drizzle/schema'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { getTenantModuleAccess } from '@/server/control/access'
import { controlDb } from '@/server/control/db'
import { suiteTenantSubscriptions, suiteSubscriptionPlans } from '@/server/control/schema'

export const runtime = 'nodejs'

async function getSubscriptionDetails(suiteTenantId: string) {
  try {
    const rows = await controlDb
      .select({
        id: suiteTenantSubscriptions.id,
        status: suiteTenantSubscriptions.status,
        planCode: suiteTenantSubscriptions.planCode,
        grantKind: suiteSubscriptionPlans.grantKind,
        grantsAgent: suiteSubscriptionPlans.grantsAgent,
        grantsReservation: suiteSubscriptionPlans.grantsReservation,
        planName: suiteSubscriptionPlans.displayName,
        lastPaidAt: suiteTenantSubscriptions.lastPaidAt,
        nextDueAt: suiteTenantSubscriptions.nextDueAt,
        planFeatures: suiteSubscriptionPlans.features,
        planLimits: suiteSubscriptionPlans.limits,
        featureOverrides: suiteTenantSubscriptions.featureOverrides,
        limitOverrides: suiteTenantSubscriptions.limitOverrides,
        priceAmount: suiteSubscriptionPlans.priceAmount,
        currency: suiteSubscriptionPlans.currency,
      })
      .from(suiteTenantSubscriptions)
      .innerJoin(suiteSubscriptionPlans, eq(suiteSubscriptionPlans.code, suiteTenantSubscriptions.planCode))
      .where(eq(suiteTenantSubscriptions.suiteTenantId, suiteTenantId))
      .orderBy(
        // Priority: active > partner/demo grants > past_due > pending_setup > others
        // This matches getLatestSubscriptionRow logic
        desc(
          sql`case
            when ${suiteTenantSubscriptions.status} = 'active' then 5
            when ${suiteSubscriptionPlans.grantKind} in ('partner', 'demo') then 4
            when ${suiteTenantSubscriptions.status} = 'past_due' then 3
            when ${suiteTenantSubscriptions.status} = 'pending_setup' then 2
            else 1
          end`,
        ),
        desc(suiteTenantSubscriptions.updatedAt),
      )
      .limit(1)

    const latest = rows[0]
    if (!latest) return null

    const isActive = latest.status === 'active'
    const isSpecialGrant = latest.grantKind === 'partner' || latest.grantKind === 'demo'
    const hasAccess = isActive || isSpecialGrant

    return {
      hasSubscription: true,
      status: latest.status,
      planCode: latest.planCode,
      planName: latest.planName,
      grantKind: latest.grantKind,
      subscriptionStatus: latest.status,
      lastPaidAt: latest.lastPaidAt,
      nextDueAt: latest.nextDueAt,
      monthlyCredits: 0,
      creditsUsed: 0,
      creditsBalance: 0,
      priceAmount: Number(latest.priceAmount || 0),
      currency: latest.currency || 'MYR',
      features: filterSubscriptionRecord({
        ...(latest.planFeatures as Record<string, boolean> || {}),
        ...(latest.featureOverrides as Record<string, boolean> || {}),
      }, 'agent.'),
      limits: filterSubscriptionRecord({
        ...(latest.planLimits as Record<string, number | string | boolean | null> || {}),
        ...(latest.limitOverrides as Record<string, number | string | boolean | null> || {}),
      }, 'agent.'),
      isActive: hasAccess,
      isSpecialGrant,
    }
  } catch {
    return null
  }
}

function filterSubscriptionRecord<T>(record: Record<string, T>, prefix: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(prefix)))
}

export async function GET(req: NextRequest) {
  // Read auth context from middleware headers (set by proxy.ts)
  const firebaseUid = req.headers.get('x-firebase-uid')
  const userEmail = req.headers.get('x-user-email')
  const suiteTenantId = req.headers.get('x-suite-tenant-id')
  const businessIdHeader = req.headers.get('x-business-id')
  const _businessId = businessIdHeader ? String(businessIdHeader) : null

  // If middleware didn't set headers, user is not authenticated
  if (!firebaseUid || !userEmail || !suiteTenantId) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  let userRows = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1)
  let user = userRows[0] ?? null
  if (!user) {
    userRows = await db.select().from(users).where(eq(users.email, userEmail)).limit(1)
    user = userRows[0] ?? null
    if (user?.firebaseUid && user.firebaseUid !== firebaseUid) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }
    if (user && !user.firebaseUid) {
      // Optimistic lock: only repair while the UID is still unset (empty string,
      // or a legacy NULL predating the NOT NULL constraint). A concurrent request
      // that already bound a UID will not match here, yielding an empty result.
      const repaired = await db
        .update(users)
        .set({ firebaseUid, updatedAt: new Date() })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.email, userEmail),
            or(isNull(users.firebaseUid), eq(users.firebaseUid, '')),
          ),
        )
        .returning()
      if (!repaired[0]) {
        return NextResponse.json({ authenticated: false }, { status: 401 })
      }
      user = repaired[0] ?? user
    }
  }

  const onboardingRequired = !user || !user.businessId
  const pendingApproval = false

  let business = null
  if (user?.businessId) {
    const bRows = await db
        .select()
        .from(businesses)
        .where(and(eq(businesses.id, user.businessId), eq(businesses.suiteTenantId, suiteTenantId)))
        .limit(1)
    business = bRows[0] ?? null
  }

  if (user?.businessId && !business) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  const access = business ? await getTenantModuleAccess(suiteTenantId, 'agent') : null

  // Fetch full subscription details for session caching
  const subscription = business ? await getSubscriptionDetails(suiteTenantId) : null

  const accessBlocked = Boolean(!onboardingRequired && !pendingApproval && access && !access.allowed)
  return NextResponse.json({
    authenticated: true,
    onboardingRequired,
    pendingApproval,
    accessBlocked,
    access,
    subscription,
    user: user
      ? {
          id: user.id,
          businessId: user.businessId,
          role: 'owner',
        }
      : null,
  })
}