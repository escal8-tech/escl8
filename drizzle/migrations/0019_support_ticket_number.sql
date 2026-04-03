CREATE SEQUENCE IF NOT EXISTS "support_ticket_number_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "ticket_number" text;
--> statement-breakpoint
WITH ordered AS (
  SELECT
    "id",
    row_number() OVER (ORDER BY "created_at" ASC, "id" ASC) AS seq_num
  FROM "support_tickets"
  WHERE coalesce("ticket_number", '') = ''
)
UPDATE "support_tickets" AS st
SET "ticket_number" = 'A' || lpad(ordered.seq_num::text, 5, '0')
FROM ordered
WHERE st."id" = ordered."id";
--> statement-breakpoint
SELECT setval(
  'support_ticket_number_seq',
  GREATEST(
    COALESCE(
      (
        SELECT max(CASE WHEN "ticket_number" ~ '^A[0-9]+$' THEN substring("ticket_number" FROM 2)::bigint ELSE 0 END)
        FROM "support_tickets"
      ),
      0
    ),
    1
  ),
  EXISTS(
    SELECT 1
    FROM "support_tickets"
    WHERE coalesce("ticket_number", '') <> ''
  )
);
--> statement-breakpoint
ALTER TABLE "support_tickets"
  ALTER COLUMN "ticket_number" SET DEFAULT ('A' || lpad(nextval('support_ticket_number_seq'::regclass)::text, 5, '0'));
--> statement-breakpoint
UPDATE "support_tickets"
SET "ticket_number" = ('A' || lpad(nextval('support_ticket_number_seq'::regclass)::text, 5, '0'))
WHERE coalesce("ticket_number", '') = '';
--> statement-breakpoint
ALTER TABLE "support_tickets" ALTER COLUMN "ticket_number" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_tickets_ticket_number_ux" ON "support_tickets" USING btree ("ticket_number");
