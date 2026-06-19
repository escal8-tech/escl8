ALTER TABLE "business_user_invites" DROP CONSTRAINT "business_user_invites_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "business_user_invites" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "business_user_invites" DROP COLUMN "channel_identity_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "channel_identity_id";