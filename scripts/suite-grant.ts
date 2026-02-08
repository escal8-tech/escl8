import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { businesses, users } from '@/../drizzle/schema';
import { controlDb } from '@/server/control/db';
import { suiteEntitlements, suiteMemberships, suiteTenants, suiteUsers } from '@/server/control/schema';

function arg(name: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

async function main() {
  const businessId = arg('businessId');
  const firebaseUid = arg('firebaseUid');
  const email = arg('email').toLowerCase();
  const role = arg('role') || 'member';

  if (!businessId || !firebaseUid || !email) {
    throw new Error('Usage: tsx scripts/suite-grant.ts --businessId=<id> --firebaseUid=<uid> --email=<email> [--role=admin]');
  }

  const business = await db.select().from(businesses).where(eq(businesses.id, businessId)).then((rows) => rows[0] ?? null);
  if (!business) throw new Error(`Business not found: ${businessId}`);

  let suiteTenantId = business.suiteTenantId;
  if (!suiteTenantId) {
    const created = await controlDb
      .insert(suiteTenants)
      .values({
        name: business.name || `Business ${businessId}`,
        metadata: { seededFrom: 'scripts/suite-grant.ts', businessId },
      })
      .returning();
    suiteTenantId = created[0]?.id ?? null;
    if (!suiteTenantId) throw new Error('Failed to create suite tenant');

    await db.update(businesses).set({ suiteTenantId, updatedAt: new Date() }).where(eq(businesses.id, businessId));
  }

  const suiteUserUpsert = await controlDb
    .insert(suiteUsers)
    .values({
      firebaseUid,
      email,
      displayName: email.split('@')[0] || 'User',
    })
    .onConflictDoUpdate({
      target: suiteUsers.firebaseUid,
      set: { email, updatedAt: new Date() },
    })
    .returning();
  const suiteUser = suiteUserUpsert[0];
  if (!suiteUser) throw new Error('Failed to upsert suite user');

  await controlDb
    .insert(suiteMemberships)
    .values({
      suiteTenantId,
      suiteUserId: suiteUser.id,
      role,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [suiteMemberships.suiteTenantId, suiteMemberships.suiteUserId],
      set: { role, isActive: true, updatedAt: new Date() },
    });

  await controlDb
    .insert(suiteEntitlements)
    .values({
      suiteTenantId,
      module: 'agent',
      status: 'active',
      metadata: { grantedBy: 'suite-grant' },
    })
    .onConflictDoUpdate({
      target: [suiteEntitlements.suiteTenantId, suiteEntitlements.module],
      set: { status: 'active', updatedAt: new Date() },
    });

  await db
    .insert(users)
    .values({
      email,
      firebaseUid,
      suiteUserId: suiteUser.id,
      businessId,
      whatsappConnected: false,
    })
    .onConflictDoUpdate({
      target: users.firebaseUid,
      set: {
        email,
        suiteUserId: suiteUser.id,
        businessId,
        updatedAt: new Date(),
      },
    });

  console.log(
    JSON.stringify(
      { ok: true, businessId, suiteTenantId, suiteUserId: suiteUser.id, firebaseUid, email, role, module: 'agent' },
      null,
      2,
    ),
  );
}

void main();
