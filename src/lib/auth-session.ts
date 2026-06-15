import { verifyFirebaseIdToken } from '@/server/firebaseAdmin';
import { queryRows } from '@/lib/db';

/**
 * Extract suiteTenantId from Firebase ID token in Authorization header
 * Server-side only - verifies Firebase token and looks up tenant
 */
export async function getSuiteTenantIdFromRequest(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const idToken = authHeader.slice(7);
  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    const firebaseUid = String(decoded.uid || '').trim();
    const email = String(decoded.email || '').trim().toLowerCase();
    
    if (!firebaseUid && !email) return null;

    // Look up tenant via suite_memberships
    const rows = await queryRows<{ id: string }>(
      'control',
      `
      SELECT st.id
      FROM suite_tenants st
      JOIN suite_memberships sm ON sm.suite_tenant_id = st.id
      JOIN suite_users su ON su.id = sm.suite_user_id
      WHERE su.firebase_uid = $1 AND sm.is_active = true
      ORDER BY sm.created_at ASC, st.id ASC
      LIMIT 1
      `,
      [firebaseUid]
    );

    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Get suiteTenantId from Firebase UID (for server-to-server)
 */
export async function getSuiteTenantIdFromFirebaseUid(firebaseUid: string): Promise<string | null> {
  const rows = await queryRows<{ id: string }>(
    'control',
    `
    SELECT st.id
    FROM suite_tenants st
    JOIN suite_memberships sm ON sm.suite_tenant_id = st.id
    JOIN suite_users su ON su.id = sm.suite_user_id
    WHERE su.firebase_uid = $1 AND sm.is_active = true
    ORDER BY sm.created_at ASC, st.id ASC
    LIMIT 1
    `,
    [firebaseUid]
  );

  return rows[0]?.id ?? null;
}

/**
 * Get suiteTenantId from business ID (for bot backend calls)
 */
export async function getSuiteTenantIdFromBusinessId(businessId: string): Promise<string | null> {
  const rows = await queryRows<{ suite_tenant_id: string }>(
    'agent',
    `
    SELECT suite_tenant_id FROM businesses WHERE id = $1
    `,
    [businessId]
  );

  return rows[0]?.suite_tenant_id ?? null;
}