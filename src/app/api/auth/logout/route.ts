import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookies, blacklistToken } from '@/lib/auth-cookies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/auth/logout - Clear auth cookies and blacklist tokens
 */
export async function DELETE(request: NextRequest) {
  // Get tokens from cookies to blacklist
  const accessToken = request.cookies.get('escal8_access_token')?.value;
  const refreshToken = request.cookies.get('escal8_refresh_token')?.value;
  
  // Blacklist both tokens
  await Promise.all([
    accessToken ? blacklistToken(accessToken) : Promise.resolve(),
    refreshToken ? blacklistToken(refreshToken) : Promise.resolve()
  ]);
  
  const response = NextResponse.json({ success: true, message: 'Logged out' });
  return clearAuthCookies(response);
}
