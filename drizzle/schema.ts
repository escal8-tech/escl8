import { pgTable, text, boolean, integer, timestamp, jsonb, uniqueIndex, index, numeric, check } from "drizzle-orm/pg-core";
import crypto from "crypto";
import { relations, sql } from "drizzle-orm";

/**
 * USERS = tenant owners (your SaaS users).
 *
 * Invariant: 1 user => 1 businessId (strict, current model).
 * If you later want multiple businesses per user, remove users.businessId
 * and rely on businesses.ownerUserId instead.
 */
export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    email: text("email").notNull(), // unique index below

    phoneNumber: text("phone_number"),

    whatsappConnected: boolean("whatsapp_connected").notNull().default(false),

    // strict: 1 business per user (unique index below)
    businessId: text("business_id"),

    // Optional booking configuration (addon)
    unitCapacity: integer("unit_capacity").default(1),
    timeslotMinutes: integer("timeslot_minutes").default(60),
    openTime: text("open_time"), // "09:00"
    closeTime: text("close_time"), // "18:00"

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // strict uniqueness
    usersEmailUx: uniqueIndex("users_email_ux").on(t.email),
    usersBusinessIdUx: uniqueIndex("users_business_id_ux").on(t.businessId),

    // helpful index
    usersBusinessIdIdx: index("users_business_id_idx").on(t.businessId),

    // non-empty checks
    usersIdNonEmpty: check("users_id_nonempty", sql`length(btrim(${t.id})) > 0`),
    usersEmailNonEmpty: check("users_email_nonempty", sql`length(btrim(${t.email})) > 0`),
    usersBusinessIdNonEmpty: check(
      "users_business_id_nonempty",
      sql`${t.businessId} is null OR length(btrim(${t.businessId})) > 0`,
    ),
  }),
);

/**
 * BUSINESSES = tenant bot brains (RAG namespace + prompt rules).
 *
 * PK is the same string you use everywhere (Pinecone namespace).
 * Invariant: business.id is globally unique.
 */
export const businesses = pgTable(
  "businesses",
  {
    // Use the tenant namespace as PK (simple and strict)
    id: text("id").primaryKey().notNull(),

    ownerUserId: text("owner_user_id").notNull(),

    name: text("name"),
    isActive: boolean("is_active").notNull().default(true),

    // Prompt/system instructions for sales assistant persona & business rules
    instructions: text("instructions").notNull(),

    ragTopK: integer("rag_top_k").default(8),
    promotionsEnabled: boolean("promotions_enabled").notNull().default(true),
    bookingsEnabled: boolean("bookings_enabled").notNull().default(false),

    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    businessesOwnerIdx: index("businesses_owner_user_id_idx").on(t.ownerUserId),
    businessesActiveIdx: index("businesses_is_active_idx").on(t.isActive),

    // strict non-empty PK + required fields
    businessesIdNonEmpty: check("businesses_id_nonempty", sql`length(btrim(${t.id})) > 0`),
    businessesOwnerNonEmpty: check(
      "businesses_owner_user_id_nonempty",
      sql`length(btrim(${t.ownerUserId})) > 0`,
    ),
    businessesInstructionsNonEmpty: check(
      "businesses_instructions_nonempty",
      sql`length(btrim(${t.instructions})) > 0`,
    ),
  }),
);

/**
 * WHATSAPP IDENTITIES = strict routing table for Option A.
 *
 * Hard rule: phoneNumberId is unique (PK) => routing can never be ambiguous.
 * Many phoneNumberId may point to the same businessId (shared bot) - allowed.
 */
export const whatsappIdentities = pgTable(
  "whatsapp_identities",
  {
    // Meta WhatsApp Cloud API phone number id (routing key from webhook metadata)
    phoneNumberId: text("phone_number_id").primaryKey().notNull(),

    // Tenant/bot brain
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict", onUpdate: "cascade" }),

    // Owner user
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),

    // Optional debug/admin fields
    wabaId: text("waba_id"),
    displayPhoneNumber: text("display_phone_number"),

    isActive: boolean("is_active").notNull().default(true),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // indexes for admin / audits
    waIdentitiesBusinessIdx: index("wa_identities_business_id_idx").on(t.businessId),
    waIdentitiesUserIdx: index("wa_identities_user_id_idx").on(t.userId),
    waIdentitiesActiveIdx: index("wa_identities_is_active_idx").on(t.isActive),

    // Optional strict uniqueness (recommended if you store these reliably):
    // A WABA should not appear across multiple tenants (usually true in practice).
    waIdentitiesWabaUx: uniqueIndex("wa_identities_waba_id_ux")
      .on(t.wabaId)
      .where(sql`${t.wabaId} is not null`),

    // The E.164 display number should not be reused across identities (usually true).
    waIdentitiesDisplayPhoneUx: uniqueIndex("wa_identities_display_phone_ux")
      .on(t.displayPhoneNumber)
      .where(sql`${t.displayPhoneNumber} is not null`),

    // strict non-empty routing ids
    waIdentitiesPhoneNumberIdNonEmpty: check(
      "wa_identities_phone_number_id_nonempty",
      sql`length(btrim(${t.phoneNumberId})) > 0`,
    ),
    waIdentitiesBusinessIdNonEmpty: check(
      "wa_identities_business_id_nonempty",
      sql`length(btrim(${t.businessId})) > 0`,
    ),
    waIdentitiesUserIdNonEmpty: check(
      "wa_identities_user_id_nonempty",
      sql`length(btrim(${t.userId})) > 0`,
    ),

    // lifecycle sanity (optional): if disconnectedAt exists, isActive should typically be false
    waIdentitiesDisconnectSanity: check(
      "wa_identities_disconnect_sanity",
      sql`${t.disconnectedAt} is null OR ${t.isActive} = false`,
    ),
  }),
);

/** Relations (optional but nice) */
export const usersRelations = relations(users, ({ one, many }) => ({
  business: one(businesses, {
    fields: [users.businessId],
    references: [businesses.id],
  }),
  whatsappIdentities: many(whatsappIdentities),
}));

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  owner: one(users, {
    fields: [businesses.ownerUserId],
    references: [users.id],
  }),
  whatsappIdentities: many(whatsappIdentities),
}));

export const whatsappIdentitiesRelations = relations(whatsappIdentities, ({ one }) => ({
  user: one(users, {
    fields: [whatsappIdentities.userId],
    references: [users.id],
  }),
  business: one(businesses, {
    fields: [whatsappIdentities.businessId],
    references: [businesses.id],
  }),
}));

/**
 * OPTIONAL: customer threads (CRM-light), per business.
 * Not required for routing, but useful for tracking and summaries outside WhatsApp.
 */
export const customerThreads = pgTable(
  "customer_threads",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    businessId: text("business_id").notNull(),

    // WhatsApp customer identifier => messages[i].from
    customerWaId: text("customer_wa_id").notNull(),

    // last seen / state
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    status: text("status").default("open"), // open | closed | vip | spam (whatever you decide)

    // Optional metadata (tags, lead source, notes)
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCustomerPerBusiness: uniqueIndex("customer_threads_business_customer_uidx").on(t.businessId, t.customerWaId),
    customerThreadsBusinessIdx: index("customer_threads_business_id_idx").on(t.businessId),
    customerThreadsLastMsgIdx: index("customer_threads_last_message_at_idx").on(t.lastMessageAt),
  })
);

/**
 * OPTIONAL: message log table (audit + debugging + analytics).
 * Can be big; if you store this, make sure you have retention or partitioning.
 */
export const messageEvents = pgTable(
  "message_events",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    businessId: text("business_id").notNull(),
    userId: text("user_id"), // tenant owner or agent (optional)
    customerWaId: text("customer_wa_id"), // messages[i].from

    // Meta message id for idempotency / tracing
    inboundMessageId: text("inbound_message_id"),

    direction: text("direction").notNull(), // inbound | outbound
    channel: text("channel").notNull().default("whatsapp_cloud"), // whatsapp_cloud | twilio_whatsapp | voice

    // Raw-ish content (don’t store secrets)
    messageType: text("message_type"), // text | audio | image | etc.
    textBody: text("text_body"),

    // Useful for debugging routing
    toPhoneNumberId: text("to_phone_number_id"),

    // Timing
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    messageEventsBusinessIdx: index("message_events_business_id_idx").on(t.businessId),
    messageEventsInboundIdIdx: index("message_events_inbound_message_id_idx").on(t.inboundMessageId),
    messageEventsCreatedIdx: index("message_events_created_at_idx").on(t.createdAt),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Customer requests (for dashboard)
export const requests = pgTable("requests", {
  id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
  customerNumber: text("customer_number").notNull(),
  sentiment: text("sentiment").notNull(), // e.g., "positive" | "neutral" | "negative"
  resolutionStatus: text("resolution_status").notNull(), // e.g., "open" | "resolved" | "pending"
  price: numeric("price", { precision: 10, scale: 2 }).default("0"),
  paid: boolean("paid").notNull().default(false),
  summary: text("summary"), // optional text summary of the request
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
// Bookings per user
export const bookings = pgTable("bookings", {
  id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  unitsBooked: integer("units_booked").notNull().default(1),
  phoneNumber: text("phone_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BookingRow = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

export type RequestRow = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
