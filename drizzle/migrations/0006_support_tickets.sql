CREATE TABLE "support_ticket_types" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmation_template" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_ticket_types_key_nonempty" CHECK (length(btrim("support_ticket_types"."key")) > 0),
	CONSTRAINT "support_ticket_types_label_nonempty" CHECK (length(btrim("support_ticket_types"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"ticket_type_id" text,
	"ticket_type_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"customer_id" text,
	"thread_id" text,
	"whatsapp_identity_id" text,
	"customer_name" text,
	"customer_phone" text,
	"title" text,
	"summary" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_by" text DEFAULT 'bot' NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_ticket_types" ADD CONSTRAINT "support_ticket_types_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_ticket_type_id_support_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."support_ticket_types"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_whatsapp_identity_id_whatsapp_identities_phone_number_id_fk" FOREIGN KEY ("whatsapp_identity_id") REFERENCES "public"."whatsapp_identities"("phone_number_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "support_ticket_types_business_id_idx" ON "support_ticket_types" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "support_ticket_types_enabled_idx" ON "support_ticket_types" USING btree ("business_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "support_ticket_types_business_key_ux" ON "support_ticket_types" USING btree ("business_id","key");--> statement-breakpoint
CREATE INDEX "support_tickets_business_id_idx" ON "support_tickets" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "support_tickets_type_idx" ON "support_tickets" USING btree ("business_id","ticket_type_key");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "support_tickets_created_at_idx" ON "support_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_customer_id_idx" ON "support_tickets" USING btree ("customer_id");--> statement-breakpoint
INSERT INTO "support_ticket_types" ("id","business_id","key","label","description","enabled","required_fields","trigger_phrases","sort_order","created_at","updated_at")
SELECT
  md5(random()::text || clock_timestamp()::text || b."id" || d."key"),
  b."id",
  d."key",
  d."label",
  d."description",
  true,
  d."required_fields"::jsonb,
  d."trigger_phrases"::jsonb,
  d."sort_order",
  now(),
  now()
FROM "businesses" b
CROSS JOIN (
  VALUES
    ('ordercreation','Order Creation','Customer wants to place an order','["name","phonenumber","items"]','["new order","place order","buy","order now"]',10),
    ('orderstatus','Order Status','Customer asks for delivery/order updates','["orderid","phonenumber"]','["order status","where is my order","delivery status","tracking"]',20),
    ('complaint','Complaint','Issues, wrong item, damaged item, service complaints','["name","phonenumber","details"]','["complaint","issue","problem","wrong item","damaged","defective"]',30),
    ('refund','Refund','Customer asks for refund processing','["orderid","reason"]','["refund","money back"]',40),
    ('cancellation','Cancellation','Customer asks to cancel order/booking','["orderid","reason"]','["cancel","cancellation"]',50),
    ('warrantyclaim','Warranty Claim','Warranty service/claim request','["name","phonenumber","warrantynumber","issue"]','["warranty","claim"]',60),
    ('invoice','Invoice / Billing','Invoice copies, billing disputes, payment references','["name","phonenumber","details"]','["invoice","billing","receipt","payment id"]',70)
) AS d("key","label","description","required_fields","trigger_phrases","sort_order")
ON CONFLICT ("business_id","key") DO NOTHING;
