import { sql, type SQLWrapper } from "drizzle-orm";

type InventoryLockExecutor = {
  execute: (query: string | SQLWrapper) => unknown;
};

export async function acquireInventoryBusinessLock(tx: InventoryLockExecutor, businessId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`inventory:${businessId}`}, 0))`);
}
