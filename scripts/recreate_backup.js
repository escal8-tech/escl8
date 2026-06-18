/* eslint-disable @typescript-eslint/no-require-imports */
const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to DB. Recreating whatsapp_identities backup...");

    // Recreate the old table exactly as it was
    await client.query(`
      CREATE TABLE IF NOT EXISTS "whatsapp_identities" (
        "phone_number_id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "waba_id" text,
        "display_phone_number" text,
        "two_step_pin" text,
        "bot_type" text DEFAULT 'AGENT' NOT NULL,
        "status" text DEFAULT 'connected' NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "ai_disabled" boolean DEFAULT false NOT NULL,
        "auto_reply_paused" boolean DEFAULT false NOT NULL,
        "monthly_credit_limit" integer DEFAULT 0 NOT NULL,
        "credit_balance" integer DEFAULT 0 NOT NULL,
        "credit_reset_at" timestamp with time zone,
        "total_credits_consumed" integer DEFAULT 0 NOT NULL,
        "total_credits_topped_up" integer DEFAULT 0 NOT NULL,
        "webhook_subscribed_at" timestamp with time zone,
        "registered_at" timestamp with time zone,
        "credit_line_shared_at" timestamp with time zone,
        "credit_line_allocation_config_id" text,
        "waba_currency" text,
        "connected_by_user_id" text,
        "connected_at" timestamp with time zone DEFAULT now(),
        "disconnected_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);

    // Fetch from new tables
    const { rows } = await client.query(`
      SELECT ci.*, wd.phone_number_id, wd.waba_id, wd.two_step_pin, 
             wd.webhook_subscribed_at, wd.registered_at, wd.credit_line_shared_at,
             wd.credit_line_allocation_config_id, wd.waba_currency
      FROM channel_identities ci
      JOIN whatsapp_identity_details wd ON ci.id = wd.channel_identity_id
    `);

    console.log(`Re-populating ${rows.length} rows into whatsapp_identities...`);

    for (const row of rows) {
      await client.query(`
        INSERT INTO "whatsapp_identities" (
          "phone_number_id", "business_id", "waba_id", "display_phone_number", "two_step_pin",
          "bot_type", "status", "is_active", "ai_disabled", "auto_reply_paused",
          "monthly_credit_limit", "credit_balance", "credit_reset_at", "total_credits_consumed",
          "total_credits_topped_up", "webhook_subscribed_at", "registered_at", "credit_line_shared_at",
          "credit_line_allocation_config_id", "waba_currency", "connected_by_user_id", "connected_at",
          "disconnected_at", "created_at", "updated_at"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
        ) ON CONFLICT ("phone_number_id") DO NOTHING;
      `, [
        row.phone_number_id, row.business_id, row.waba_id, row.display_phone_number, row.two_step_pin,
        row.bot_type, row.status, row.is_active, !row.ai_enabled, row.auto_reply_paused,
        row.monthly_credit_limit, row.credit_balance, row.credit_reset_at, row.total_credits_consumed,
        row.total_credits_topped_up, row.webhook_subscribed_at, row.registered_at, row.credit_line_shared_at,
        row.credit_line_allocation_config_id, row.waba_currency, row.connected_by_user_id, row.connected_at,
        row.disconnected_at, row.created_at, row.updated_at
      ]);
    }

    console.log("Successfully recreated backup table.");

  } catch (err) {
    console.error("Failed:", err);
  } finally {
    await client.end();
  }
}

run();
