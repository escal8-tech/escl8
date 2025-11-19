import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';

// Load variables from .env.local if present
loadEnv({ path: '.env.local' });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL in environment');
  process.exit(1);
}

const needsSSL = /azure\.com|neon\.tech|supabase\.co|render\.com/i.test(url)
  || /sslmode=require/i.test(url)
  || process.env.DATABASE_SSL === 'true';

const client = new Client({
  connectionString: url,
  ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        email text NOT NULL UNIQUE,
        phone_number text,
        whatsapp_connected boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    console.log('Users table ensured.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
