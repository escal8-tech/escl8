import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const controlConnectionString = process.env.CONTROL_PLANE_DATABASE_URL
const needsSSL = /azure\.com|neon\.tech|supabase\.co|render\.com/i.test(controlConnectionString || '')
  || /sslmode=require/i.test(controlConnectionString || '')
  || process.env.DATABASE_SSL === 'true'

const pool = new Pool({
  connectionString: controlConnectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.CONTROL_DB_POOL_MAX ?? '10'),
  idleTimeoutMillis: Number(process.env.CONTROL_DB_POOL_IDLE_TIMEOUT_MS ?? '30000'),
  connectionTimeoutMillis: Number(process.env.CONTROL_DB_POOL_CONN_TIMEOUT_MS ?? '5000'),
})

export const controlDb = drizzle(pool, { schema })
