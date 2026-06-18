const { Pool } = require("pg");
require("dotenv").config();

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await pool.query('ALTER TABLE channel_identities ADD COLUMN IF NOT EXISTS use_shared_pool BOOLEAN NOT NULL DEFAULT true');
    console.log("Added use_shared_pool column successfully!");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
