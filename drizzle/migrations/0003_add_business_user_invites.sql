CREATE TABLE IF NOT EXISTS "business_user_invites" (
  "id" text PRIMARY KEY NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE cascade ON UPDATE cascade,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "token_hash" text NOT NULL,
  "invited_by_user_id" text REFERENCES "users"("id") ON DELETE set null ON UPDATE cascade,
  "accepted_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_user_invites_token_ux" ON "business_user_invites" ("token_hash");
CREATE INDEX IF NOT EXISTS "business_user_invites_business_email_idx" ON "business_user_invites" ("business_id", "email");
CREATE INDEX IF NOT EXISTS "business_user_invites_accepted_idx" ON "business_user_invites" ("accepted_at");
