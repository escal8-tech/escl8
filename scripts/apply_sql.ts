import "dotenv/config";
import { db } from "../src/server/db/client";

async function main() {
  const pool = (db as any).session.client;
  
  console.log("Applying SQL migration manually...");
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "agents" (
        "id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "name" text DEFAULT 'Default Agent' NOT NULL,
        "bot_type" text DEFAULT 'AGENT' NOT NULL,
        "prompt_override" text,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    console.log("Table 'agents' created.");

    await pool.query(`ALTER TABLE "channel_identities" ADD COLUMN IF NOT EXISTS "agent_id" text;`);
    console.log("Added agent_id to channel_identities");

    await pool.query(`ALTER TABLE "training_documents" ADD COLUMN IF NOT EXISTS "agent_id" text;`);
    console.log("Added agent_id to training_documents");

    try {
      await pool.query(`ALTER TABLE "training_documents" ADD CONSTRAINT "training_documents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE cascade;`);
      console.log("Added foreign key for training_documents");
    } catch(e: any) { console.log(e.message) }

    try {
      await pool.query(`ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE cascade;`);
      console.log("Added foreign key for channel_identities");
    } catch(e: any) { console.log(e.message) }

    try {
      await pool.query(`DROP INDEX IF EXISTS "training_documents_business_doc_type_ux";`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "training_documents_agent_id_doc_type_ux" ON "training_documents" USING btree ("agent_id","doc_type");`);
      console.log("Updated unique index for training_documents");
    } catch(e: any) { console.log(e.message) }

    try {
      await pool.query(`ALTER TABLE "agents" DROP COLUMN IF EXISTS "agent_id";`);
      await pool.query(`ALTER TABLE "channel_identities" DROP COLUMN IF EXISTS "bot_type";`);
      await pool.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "agent_id";`);
      console.log("Dropped old columns");
    } catch(e: any) { console.log(e.message) }
    
  } catch(e) {
    console.error("Migration failed:", e);
  }
  
  console.log("Migration applied successfully!");
  process.exit(0);
}

main().catch(e => {
  console.error("Failed:", e);
  process.exit(1);
});
