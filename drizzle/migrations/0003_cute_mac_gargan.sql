ALTER TABLE "agents" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "channel_identity_id" text;--> statement-breakpoint
ALTER TABLE "business_user_invites" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "business_user_invites" ADD COLUMN "channel_identity_id" text;--> statement-breakpoint
ALTER TABLE "commerce_offers" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "commerce_products" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "channel_identity_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_user_invites" ADD CONSTRAINT "business_user_invites_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_offers" ADD CONSTRAINT "commerce_offers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;