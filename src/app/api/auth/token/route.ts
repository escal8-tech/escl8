import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseIdToken } from '@/server/firebaseAdmin';
import { generateTokenPair } from '@/lib/jwt-auth';
import { db } from '@/server/db/client';
import { users, businesses } from '@/../drizzle/schema';
import { eq, and } from 'drizzle-orm';

import { setAuthCookies } from '@/lib/auth-cookies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


/**
 * POST /api/auth/token - Exchange Firebase ID token for Escal8 JWT pair
 * Body: { idToken: string, module?: 'agent' | 'reservation' }
 * Rate limited: 10 requests per minute per IP
 * Returns: Sets httpOnly cookies (accessToken, refreshToken)
 */
export async function POST(request: NextRequest) {

  try {
    const body = await request.json();
    const { idToken, module = 'agent' } = body;

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

    // Look up user's assigned businessId and suiteTenantId
    const userRows = await db
      .select({ 
        businessId: users.businessId,
        suiteTenantId: businesses.suiteTenantId
      })
      .from(users)
      .innerJoin(businesses, eq(users.businessId, businesses.id))
      .where(eq(users.firebaseUid, firebaseUid))
      .limit(1);

    const suiteTenantId = userRows[0]?.suiteTenantId ?? null;
    const userBusinessId = userRows[0]?.businessId ?? null;

    if (!suiteTenantId) {
      return NextResponse.json({ error: 'No active tenant found for user' }, { status: 403 });
    }

    // Generate token pair with user's businessId
    const tokens = await generateTokenPair(firebaseUid, email, suiteTenantId, module as 'agent' | 'reservation', userBusinessId);

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

