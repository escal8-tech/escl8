import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseIdToken } from '@/server/firebaseAdmin';
import { queryRows } from '@/lib/db';
import { generateTokenPair } from '@/lib/jwt-auth';
import { db } from '@/server/db/client';
import { users, businesses } from '@/../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { setAuthCookies, clearAuthCookies, blacklistToken } from '@/lib/auth-cookies';
import { checkRateLimit, getClientIp } from '@/lib/auth-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


/**
 * POST /api/auth/token - Exchange Firebase ID token for Escal8 JWT pair
 * Body: { idToken: string, module?: 'agent' | 'reservation' }
 * Rate limited: 10 requests per minute per IP
 * Returns: Sets httpOnly cookies (accessToken, refreshToken)
 */
export async function POST(request: NextRequest) {
  const rateLimitError = await checkRateLimit(request, RATE_LIMITS.AUTH_TOKEN);
  if (rateLimitError) return rateLimitError;

  try {
    const body = await request.json();
    const { idToken, module = 'agent' } = body;

    const VALID_MODULES = ['agent', 'reservation'] as const;
    const validatedModule: 'agent' | 'reservation' = VALID_MODULES.includes(module) ? module : 'agent';

    if (!idToken) {
      return NextResponse.json({ error: 'idToken is required' }, { status: 400 });
    }

    // Verify Firebase ID token
    let decoded;
    try {
      decoded = await verifyFirebaseIdToken(idToken);
    } catch {
      return NextResponse.json({ error: 'Invalid Firebase token' }, { status: 401 });
    }

    const firebaseUid = String(decoded.uid || '').trim();
    const email = String(decoded.email || '').trim().toLowerCase();
    
    if (!firebaseUid || !email) {
      return NextResponse.json({ error: 'Invalid token payload' }, { status: 401 });
    }

    // Look up tenant via suite_memberships
    const rows = await queryRows<{ id: string }>(
      'control',
      `
      SELECT st.id
      FROM suite_tenants st
      JOIN suite_memberships sm ON sm.suite_tenant_id = st.id
      JOIN suite_users su ON su.id = sm.suite_user_id
      WHERE su.firebase_uid = $1 AND sm.is_active = true
      LIMIT 1
      `,
      [firebaseUid]
    );

    const suiteTenantId = rows[0]?.id;
    if (!suiteTenantId) {
      return NextResponse.json({ error: 'No active tenant found for user' }, { status: 403 });
    }

    // Look up user's assigned businessId, constrained by suiteTenantId
    const userRows = await db
      .select({ businessId: users.businessId })
      .from(users)
      .innerJoin(businesses, eq(users.businessId, businesses.id))
      .where(and(eq(users.firebaseUid, firebaseUid), eq(businesses.suiteTenantId, suiteTenantId)))
      .limit(1);
    const userBusinessId = userRows[0]?.businessId ?? null;

    // Generate token pair with user's businessId
    const tokens = await generateTokenPair(firebaseUid, email, suiteTenantId, validatedModule, userBusinessId);

    // Return response with httpOnly cookies set
    const response = NextResponse.json({ 
      success: true, 
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer' 
    });
    
    return setAuthCookies(response, tokens.accessToken, tokens.refreshToken);
  } catch (error) {
    console.error('[auth/token] Error:', error);
    return NextResponse.json({ error: 'Token generation failed' }, { status: 500 });
  }
}

