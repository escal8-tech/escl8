import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../../drizzle/schema";

const connectionString = process.env.DATABASE_URL;
const needsSSL = /azure\.com|neon\.tech|supabase\.co|render\.com/i.test(connectionString || "")
  || /sslmode=require/i.test(connectionString || "")
  || process.env.DATABASE_SSL === "true";

const poolMax = Number(process.env.DB_POOL_MAX ?? "20");
const poolMin = Number(process.env.DB_POOL_MIN ?? "2");
const idleTimeoutMs = Number(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? "30000");
const connectionTimeoutMs = Number(process.env.DB_POOL_CONN_TIMEOUT_MS ?? "5000");
const queryTimeoutMs = Number(process.env.DB_QUERY_TIMEOUT_MS ?? "15000");
const statementTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? "20000");
const idleInTransactionSessionTimeoutMs = Number(process.env.DB_IDLE_IN_TX_TIMEOUT_MS ?? "10000");
const poolMaxUses = Number(process.env.DB_POOL_MAX_USES ?? "7500");

const pool = new Pool({
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
  max: Number.isFinite(poolMax) ? poolMax : 20,
  min: Number.isFinite(poolMin) ? poolMin : 2,
  idleTimeoutMillis: Number.isFinite(idleTimeoutMs) ? idleTimeoutMs : 30000,
  connectionTimeoutMillis: Number.isFinite(connectionTimeoutMs) ? connectionTimeoutMs : 5000,
  query_timeout: Number.isFinite(queryTimeoutMs) ? queryTimeoutMs : 15000,
  statement_timeout: Number.isFinite(statementTimeoutMs) ? statementTimeoutMs : 20000,
  idle_in_transaction_session_timeout: Number.isFinite(idleInTransactionSessionTimeoutMs)
    ? idleInTransactionSessionTimeoutMs
    : 10000,
  maxUses: Number.isFinite(poolMaxUses) ? poolMaxUses : 7500,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

export const db = drizzle(pool, { schema });
export type DbClient = typeof db;
