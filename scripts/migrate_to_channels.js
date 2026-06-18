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
    console.log("Connected to DB. Starting migration to channels...");

    await client.query("BEGIN");

    // 1. Create the new tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS "channel_identities" (
        "id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "provider" text NOT NULL,
        "external_account_id" text NOT NULL,
        "display_name" text,
        "display_handle" text,
        "bot_type" text DEFAULT 'AGENT' NOT NULL,
        "status" text DEFAULT 'connected' NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "ai_enabled" boolean DEFAULT true NOT NULL,
        "auto_reply_paused" boolean DEFAULT false NOT NULL,
        "monthly_credit_limit" integer DEFAULT 0 NOT NULL,
        "credit_balance" integer DEFAULT 0 NOT NULL,
        "credit_reset_at" timestamp with time zone,
        "total_credits_consumed" integer DEFAULT 0 NOT NULL,
        "total_credits_topped_up" integer DEFAULT 0 NOT NULL,
        "metadata" jsonb DEFAULT '{}'::jsonb,
        "connected_by_user_id" text,
        "connected_at" timestamp with time zone DEFAULT now(),
        "disconnected_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "whatsapp_identity_details" (
        "channel_identity_id" text PRIMARY KEY REFERENCES "channel_identities"("id") ON DELETE CASCADE,
        "phone_number_id" text NOT NULL,
        "waba_id" text,
        "display_phone_number" text,
        "two_step_pin" text,
        "webhook_subscribed_at" timestamp with time zone,
        "registered_at" timestamp with time zone,
        "credit_line_shared_at" timestamp with time zone,
        "credit_line_allocation_config_id" text,
        "waba_currency" text
      );
    `);

    // 2. Fetch existing data
    const { rows: waRows } = await client.query('SELECT * FROM "whatsapp_identities"');
    console.log(`Found ${waRows.length} rows in whatsapp_identities`);

    // 3. Insert into new tables
    const crypto = require('crypto');
    const dependentTables = [
      'customers', 'message_threads', 'ai_usage_events', 'support_tickets', 'message_outbox',
      'credit_consumption_events', 'credit_topups', 'commerce_order_payments', 'commerce_orders'
    ];
    
    for (const row of waRows) {
      const newUuid = crypto.randomUUID();
      row.newUuid = newUuid;
      
      await client.query(`
        INSERT INTO "channel_identities" (
          "id", "business_id", "provider", "external_account_id", "display_name", "display_handle",
          "bot_type", "status", "is_active", "ai_enabled", "auto_reply_paused", "monthly_credit_limit",
          "credit_balance", "credit_reset_at", "total_credits_consumed", "total_credits_topped_up",
          "connected_by_user_id", "connected_at", "disconnected_at", "created_at", "updated_at"
        ) VALUES (
          $1, $2, 'whatsapp', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        ) ON CONFLICT ("id") DO NOTHING;
      `, [
        newUuid, row.business_id, row.phone_number_id, row.display_phone_number, row.display_phone_number,
        row.bot_type || 'AGENT', row.status || 'connected', row.is_active === false ? false : true,
        row.ai_disabled ? false : true, row.auto_reply_paused === true ? true : false,
        row.monthly_credit_limit || 0, row.credit_balance || 0, row.credit_reset_at,
        row.total_credits_consumed || 0, row.total_credits_topped_up || 0,
        row.connected_by_user_id, row.connected_at, row.disconnected_at, row.created_at || new Date(), row.updated_at || new Date()
      ]);

      await client.query(`
        INSERT INTO "whatsapp_identity_details" (
          "channel_identity_id", "phone_number_id", "waba_id", "display_phone_number", "two_step_pin",
          "webhook_subscribed_at", "registered_at", "credit_line_shared_at", "credit_line_allocation_config_id", "waba_currency"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        ) ON CONFLICT ("channel_identity_id") DO NOTHING;
      `, [
        newUuid, row.phone_number_id, row.waba_id, row.display_phone_number, row.two_step_pin,
        row.webhook_subscribed_at, row.registered_at, row.credit_line_shared_at, row.credit_line_allocation_config_id, row.waba_currency
      ]);
    }

    // 4. Drop foreign key constraints on whatsapp_identity_id first
    for (const table of dependentTables) {
      const { rows } = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = 'whatsapp_identity_id'
      `, [table]);

      if (rows.length > 0) {
        console.log(`Dropping constraints for whatsapp_identity_id in ${table}`);
        await client.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${table}_whatsapp_identity_id_whatsapp_identities_id_fk"`);
        await client.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${table}_whatsapp_identity_fk"`);
        await client.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${table}_whatsapp_identity_id_whatsapp_identities_phone_number_id_fk"`);
        
        const { rows: constraints } = await client.query(`
          SELECT constraint_name 
          FROM information_schema.key_column_usage 
          WHERE table_name = $1 AND column_name = 'whatsapp_identity_id'
        `, [table]);
        for (const c of constraints) {
          await client.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${c.constraint_name}"`);
        }
      }
    }

    // 5. Update references to this phone_number_id in dependent tables with the new UUID
    for (const row of waRows) {
      for (const table of dependentTables) {
        const { rows: hasCol } = await client.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = $1 AND column_name = 'whatsapp_identity_id'
        `, [table]);

        if (hasCol.length > 0) {
          await client.query(`
            UPDATE "${table}" 
            SET "whatsapp_identity_id" = $1 
            WHERE "whatsapp_identity_id" = $2
          `, [row.newUuid, row.phone_number_id]);
        }
      }
    }

    // 6. Rename column and add new constraint
    for (const table of dependentTables) {
      const { rows } = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = 'whatsapp_identity_id'
      `, [table]);

      if (rows.length > 0) {
        console.log(`Renaming to channel_identity_id in ${table}`);
        await client.query(`ALTER TABLE "${table}" RENAME COLUMN "whatsapp_identity_id" TO "channel_identity_id"`);
        
        await client.query(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_channel_identity_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "channel_identities"("id") ON DELETE SET NULL`);
      }
    }

    // 7. Drop old table
    console.log("Dropping old whatsapp_identities table...");
    await client.query('DROP TABLE IF EXISTS "whatsapp_identities" CASCADE');

    await client.query("COMMIT");
    console.log("Migration successful!");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed, rolled back.", err);
  } finally {
    await client.end();
  }
}

run();
