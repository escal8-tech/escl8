import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../../drizzle/schema";

const connectionString = process.env.DATABASE_URL;
const needsSSL = /azure\.com|neon\.tech|supabase\.co|render\.com/i.test(connectionString || "")
  || /sslmode=require/i.test(connectionString || "")
  || process.env.DATABASE_SSL === "true";

const pool = new Pool({
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
export type DbClient = typeof db;
