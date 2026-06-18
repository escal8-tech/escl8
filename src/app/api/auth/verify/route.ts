import { NextRequest, NextResponse } from 'next/server';
import { validateAuthToken } from '@/lib/jwt-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/verify - Verify access token and return subscription claims
 */
export async function GET(request: NextRequest) {
  try {
    const result = await validateAuthToken(request);
    
    if (!result.valid) {
      return NextResponse.json({ valid: false, error: result.error }, { status: 401 });
    }

    return NextResponse.json({
      valid: true,
      payload: {
        sub: result.payload!.sub,
        email: result.payload!.email,
        suiteTenantId: result.payload!.suiteTenantId,
        subscription: result.payload!.subscription,
      },
    });
  } catch (error) {
    console.error('[auth/verify] Error:', error);
    return NextResponse.json({ valid: false, error: 'Verification failed' }, { status: 500 });
  }
}
