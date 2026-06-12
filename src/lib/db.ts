import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

type PoolKind = "agent" | "control";
type PoolEntry = {
  connectionString: string | null;
  pool: Pool | null;
};

const globalForPools = globalThis as typeof globalThis & {
  __escl8Pools?: Partial<Record<PoolKind, PoolEntry>>;
};

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveConnectionString(kind: PoolKind) {
  if (kind === "agent") {
    return (
      process.env.AGENT_DATABASE_URL ??
      process.env.ESCL8_DATABASE_URL ??
      process.env.ESCAL8_AGENT_DATABASE_URL ??
      null
    );
  }
  return process.env.CONTROL_PLANE_DATABASE_URL ?? null;
}

function needsSsl(connectionString: string) {
  return (
    /azure\.com|neon\.tech|supabase\.co|render\.com/i.test(connectionString) ||
    /sslmode=require/i.test(connectionString)
  );
}

function getPool(kind: PoolKind) {
  globalForPools.__escl8Pools ??= {};
  const connectionString = resolveConnectionString(kind);
  const existingEntry = globalForPools.__escl8Pools[kind];

  if (existingEntry && existingEntry.connectionString === connectionString) {
    return existingEntry.pool;
  }

  if (existingEntry?.pool) {
    void existingEntry.pool.end().catch(() => undefined);
  }

  if (!connectionString) {
    globalForPools.__escl8Pools[kind] = {
      connectionString: null,
      pool: null,
    };
    return null;
  }

  const pool = new Pool({
    connectionString,
    max: readPositiveIntEnv("AGENT_DB_POOL_MAX", 2),
    idleTimeoutMillis: readPositiveIntEnv("AGENT_DB_IDLE_TIMEOUT_SECONDS", 20) * 1000,
    connectionTimeoutMillis: readPositiveIntEnv("AGENT_DB_CONNECT_TIMEOUT_SECONDS", 5) * 1000,
    ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

  globalForPools.__escl8Pools[kind] = {
    connectionString,
    pool,
  };
  return pool;
}

export async function queryRows<T extends QueryResultRow>(
  kind: PoolKind,
  queryText: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = getPool(kind);
  if (!pool) return [];
  const result = await pool.query<T>(queryText, params);
  return result.rows;
}

export async function executeStatement(
  kind: PoolKind,
  queryText: string,
  params: unknown[] = [],
) {
  const pool = getPool(kind);
  if (!pool) {
    throw new Error(`Database connection for ${kind} is not configured.`);
  }
  return pool.query(queryText, params);
}

export async function withTransaction<T>(
  kind: PoolKind,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool(kind);
  if (!pool) {
    throw new Error(`Database connection for ${kind} is not configured.`);
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}