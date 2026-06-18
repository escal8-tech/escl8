ALTER TABLE "agents" DROP CONSTRAINT "agents_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_agent_id_agents_id_fk";
--> statement-breakpoint
DROP INDEX "training_documents_business_doc_type_ux";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "bot_type" text DEFAULT 'AGENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "training_documents_agent_id_doc_type_ux" ON "training_documents" USING btree ("agent_id","doc_type");--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "channel_identities" DROP COLUMN "bot_type";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "agent_id";