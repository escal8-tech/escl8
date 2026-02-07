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

const pool = new Pool({
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
  max: Number.isFinite(poolMax) ? poolMax : 20,
  min: Number.isFinite(poolMin) ? poolMin : 2,
  idleTimeoutMillis: Number.isFinite(idleTimeoutMs) ? idleTimeoutMs : 30000,
  connectionTimeoutMillis: Number.isFinite(connectionTimeoutMs) ? connectionTimeoutMs : 5000,
});

export const db = drizzle(pool, { schema });
export type DbClient = typeof db;
