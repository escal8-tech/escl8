import { pgTable, text, boolean, integer, timestamp, jsonb, uniqueIndex, index, numeric, check } from "drizzle-orm/pg-core";
import crypto from "crypto";
import { relations, sql } from "drizzle-orm";

/**
 * BUSINESSES = tenant bot brains (RAG namespace + prompt rules).
 *
 * PK is the same string you use everywhere (Pinecone namespace).
 * Invariant:
 * - business.id is globally unique
 * - business can have many users
 * - business can have many WhatsApp identities (phone_number_id)
 */
// businesses.ts (add booking config at business level)
export const businesses = pgTable(
  "businesses",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name"),
    isActive: boolean("is_active").notNull().default(true),
    instructions: text("instructions").notNull(),
    ragTopK: integer("rag_top_k").default(8),
    promotionsEnabled: boolean("promotions_enabled").notNull().default(true),
    bookingsEnabled: boolean("bookings_enabled").notNull().default(false),

    // NEW: business-level booking config
    bookingUnitCapacity: integer("booking_unit_capacity").default(1),
    bookingTimeslotMinutes: integer("booking_timeslot_minutes").default(60),
    bookingOpenTime: text("booking_open_time"),   // "09:00"
    bookingCloseTime: text("booking_close_time"), // "18:00"

    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    businessesActiveIdx: index("businesses_is_active_idx").on(t.isActive),
    businessesIdNonEmpty: check("businesses_id_nonempty", sql`length(btrim(${t.id})) > 0`),
    businessesInstructionsNonEmpty: check(
      "businesses_instructions_nonempty",
      sql`length(btrim(${t.instructions})) > 0`,
    ),
  }),
);

/**
 * USERS = dashboard users (your SaaS users).
 *
 * Invariant (your stated requirement):
 * - each user belongs to exactly 1 business
 * - many users can belong to the same business
 *
 * NOTE: businessId is NOT unique here.
 */
export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    email: text("email").notNull(), // unique index below

    whatsappConnected: boolean("whatsapp_connected").notNull().default(false),

    // Each user belongs to exactly one business (multi-user per business is allowed)
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict", onUpdate: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    usersEmailUx: uniqueIndex("users_email_ux").on(t.email),
    usersBusinessIdIdx: index("users_business_id_idx").on(t.businessId),
    usersIdNonEmpty: check("users_id_nonempty", sql`length(btrim(${t.id})) > 0`),
    usersEmailNonEmpty: check("users_email_nonempty", sql`length(btrim(${t.email})) > 0`),
    usersBusinessIdNonEmpty: check("users_business_id_nonempty", sql`length(btrim(${t.businessId})) > 0`),
  }),
);

/**
 * WHATSAPP IDENTITIES = strict routing table for Option A.
 *
 * Hard rule: phoneNumberId is unique (PK) => routing can never be ambiguous.
 * Rules you requested:
 * - 1 phoneNumberId => 1 businessId (strict)
 * - a business can have many phoneNumberIds
 * - many users belong to the business and share the dashboard
 *
 * IMPORTANT: we do NOT bind the identity to a single user.
 * If you want audit ("who connected it"), use connectedByUserId (nullable).
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

    // Optional audit field only (NOT ownership, NOT routing)
    connectedByUserId: text("connected_by_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

    // Optional debug/admin fields
    wabaId: text("waba_id"),
    displayPhoneNumber: text("display_phone_number"),

    // Customer-scoped business token (Business Integration System User token)
    // Stored in plaintext on this column for simple retrieval. WARNING: less secure.
    businessToken: text("business_token"),

    // Phone number two-step verification PIN used for /register (plaintext).
    twoStepPin: text("two_step_pin"),

    webhookSubscribedAt: timestamp("webhook_subscribed_at", { withTimezone: true }),
    registeredAt: timestamp("registered_at", { withTimezone: true }),

    // Solution Partner: credit line sharing state
    creditLineSharedAt: timestamp("credit_line_shared_at", { withTimezone: true }),
    creditLineAllocationConfigId: text("credit_line_allocation_config_id"),
    wabaCurrency: text("waba_currency"),

    isActive: boolean("is_active").notNull().default(true),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // indexes for admin / audits
    waIdentitiesBusinessIdx: index("wa_identities_business_id_idx").on(t.businessId),
    waIdentitiesActiveIdx: index("wa_identities_is_active_idx").on(t.isActive),
    waIdentitiesConnectedByIdx: index("wa_identities_connected_by_user_id_idx").on(t.connectedByUserId),

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

    // lifecycle sanity (optional): if disconnectedAt exists, isActive should typically be false
    waIdentitiesDisconnectSanity: check(
      "wa_identities_disconnect_sanity",
      sql`${t.disconnectedAt} is null OR ${t.isActive} = false`,
    ),
  }),
);

/** Relations (optional but nice) */
export const usersRelations = relations(users, ({ one }) => ({
  business: one(businesses, {
    fields: [users.businessId],
    references: [businesses.id],
  }),
}));

export const businessesRelations = relations(businesses, ({ many }) => ({
  users: many(users),
  whatsappIdentities: many(whatsappIdentities),
  customers: many(customers),
  requests: many(requests),
}));

export const whatsappIdentitiesRelations = relations(whatsappIdentities, ({ one }) => ({
  business: one(businesses, {
    fields: [whatsappIdentities.businessId],
    references: [businesses.id],
  }),
  connectedByUser: one(users, {
    fields: [whatsappIdentities.connectedByUserId],
    references: [users.id],
  }),
}));

/**
 * @deprecated Use `customers` table instead. This table is kept for backwards compatibility
 * and will be removed in a future migration. Do not use for new code.
 * 
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

/**
 * SUPPORTED SOURCES - all channels the platform can handle
 * Add new sources here as the platform expands
 */
export const SUPPORTED_SOURCES = [
  'whatsapp',
  'shopee',
  'lazada',
  'telegram',
  'instagram',
  'facebook',
  'email',
  'web',
  'other',
] as const;
export type Source = (typeof SUPPORTED_SOURCES)[number];

/**
 * CUSTOMERS = CRM table for unique customers per source per business.
 * 
 * Has a UUID primary key for easy FK references.
 * Unique constraint on (businessId, source, externalId) - one row per customer per channel.
 * If same person uses WhatsApp + Instagram + Facebook, they get 3 separate rows.
 * This is intentional: cross-platform matching is error-prone and unnecessary.
 * Each channel has its own customer profile, stats, and history.
 */
export const customers = pgTable(
  "customers",
  {
    // UUID primary key for easy FK references
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    // Business scope
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict", onUpdate: "cascade" }),
    
    // Source/channel this customer came from
    source: text("source").notNull().default("whatsapp"), // whatsapp | instagram | facebook | telegram | etc.
    
    // External ID from that source (phone for WhatsApp, IGSID for Instagram, PSID for Messenger, etc.)
    externalId: text("external_id").notNull(),

    // Profile info (can be updated from platform APIs or manually)
    name: text("name"),
    email: text("email"),
    phone: text("phone"), // separate from externalId since platform ID != phone
    profilePictureUrl: text("profile_picture_url"),
    
    // Platform-specific metadata (username, shop name, etc.)
    platformMeta: jsonb("platform_meta").$type<Record<string, unknown>>().default({}),

    // Cached aggregates (updated on each request for fast reads)
    totalRequests: integer("total_requests").notNull().default(0),
    totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).notNull().default("0"),
    successfulRequests: integer("successful_requests").notNull().default(0),

    // Lead scoring & intent signals
    leadScore: integer("lead_score").notNull().default(0),
    isHighIntent: boolean("is_high_intent").notNull().default(false),
    
    // Sentiment tracking
    lastSentiment: text("last_sentiment"),
    
    // Activity timestamps
    firstMessageAt: timestamp("first_message_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),

    // Manual CRM fields
    tags: jsonb("tags").$type<string[]>().default([]),
    notes: text("notes"),
    assignedToUserId: text("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

    // Status
    status: text("status").notNull().default("active"),

    // Soft delete
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Unique constraint: business + source + externalId (one customer per channel)
    customersCompositeUx: uniqueIndex("customers_composite_ux").on(t.businessId, t.source, t.externalId),
    
    // Fast lookups
    customersBusinessIdx: index("customers_business_id_idx").on(t.businessId),
    customersSourceIdx: index("customers_source_idx").on(t.source),
    customersBusinessSourceIdx: index("customers_business_source_idx").on(t.businessId, t.source),
    customersExternalIdIdx: index("customers_external_id_idx").on(t.externalId),
    customersLastMessageIdx: index("customers_last_message_at_idx").on(t.lastMessageAt),
    customersLeadScoreIdx: index("customers_lead_score_idx").on(t.leadScore),
    customersHighIntentIdx: index("customers_high_intent_idx").on(t.businessId, t.isHighIntent),
    customersTotalRevenueIdx: index("customers_total_revenue_idx").on(t.businessId, t.totalRevenue),
    // Soft delete filter
    customersDeletedAtIdx: index("customers_deleted_at_idx").on(t.deletedAt),

    // Sanity checks
    customersIdNonEmpty: check(
      "customers_id_nonempty",
      sql`length(btrim(${t.id})) > 0`,
    ),
    customersBusinessIdNonEmpty: check(
      "customers_business_id_nonempty",
      sql`length(btrim(${t.businessId})) > 0`,
    ),
    customersExternalIdNonEmpty: check(
      "customers_external_id_nonempty",
      sql`length(btrim(${t.externalId})) > 0`,
    ),
  }),
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  business: one(businesses, {
    fields: [customers.businessId],
    references: [businesses.id],
  }),
  assignedTo: one(users, {
    fields: [customers.assignedToUserId],
    references: [users.id],
  }),
  requests: many(requests),
}));

export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

// Customer requests (per business dashboard) - multi-source
export const requests = pgTable(
  "requests",
  {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),

    // Tenant scope
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict", onUpdate: "cascade" }),

    // FK to customer (UUID)
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

    // Customer phone number (nullable - some platforms like Instagram/Messenger don't have phone)
    customerNumber: text("customer_number"),

    // Source/channel this request came from (defaults to whatsapp for existing data)
    source: text("source").notNull().default("whatsapp"), // whatsapp | instagram | facebook | telegram | etc.

    // Platform-specific metadata (order ID, chat ID, conversation ID, etc.)
    sourceMeta: jsonb("source_meta").$type<Record<string, unknown>>().default({}),

    sentiment: text("sentiment").notNull(), // "positive" | "neutral" | "negative"
    resolutionStatus: text("resolution_status").notNull(), // "open" | "resolved" | "pending" | "requires_assistance"

    price: numeric("price", { precision: 10, scale: 2 }).default("0"),
    paid: boolean("paid").notNull().default(false),

    summary: text("summary"),

    // Soft delete
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // dashboard queries
    requestsBusinessIdx: index("requests_business_id_idx").on(t.businessId),
    requestsCustomerIdx: index("requests_customer_number_idx").on(t.customerNumber),
    requestsCustomerIdIdx: index("requests_customer_id_idx").on(t.customerId),
    requestsBusinessCustomerIdx: index("requests_business_customer_idx").on(t.businessId, t.customerNumber),
    requestsStatusIdx: index("requests_resolution_status_idx").on(t.resolutionStatus),
    requestsSourceIdx: index("requests_source_idx").on(t.source),
    requestsBusinessSourceIdx: index("requests_business_source_idx").on(t.businessId, t.source),
    requestsCreatedAtIdx: index("requests_created_at_idx").on(t.createdAt),
    requestsDeletedAtIdx: index("requests_deleted_at_idx").on(t.deletedAt),

    // sanity
    requestsIdNonEmpty: check("requests_id_nonempty", sql`length(btrim(${t.id})) > 0`),
    requestsBusinessIdNonEmpty: check(
      "requests_business_id_nonempty",
      sql`length(btrim(${t.businessId})) > 0`,
    ),
  }),
);

// Relations: requests -> business & customer
export const requestsRelations = relations(requests, ({ one }) => ({
  business: one(businesses, {
    fields: [requests.businessId],
    references: [businesses.id],
  }),
  customer: one(customers, {
    fields: [requests.customerId],
    references: [customers.id],
  }),
}));

// Bookings per business (userId is a platform user identifier, not a FK since many users share same business)
export const bookings = pgTable("bookings", {
  id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
  businessId: text("business_id").notNull().references(() => businesses.id, { onDelete: "restrict", onUpdate: "cascade" }),
  // userId is a platform user identifier (e.g. phone number, email) - NOT a FK to users table
  // Multiple dashboard users can manage the same business's bookings
  userId: text("user_id").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  unitsBooked: integer("units_booked").notNull().default(1),
  phoneNumber: text("phone_number"),
  notes: text("notes"),
  // Soft delete
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BookingRow = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

export type RequestRow = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;

// ==========================
// RAG / Training Documents
// ==========================

export const trainingDocuments = pgTable(
  "training_documents",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict", onUpdate: "cascade" }),

    // One of the 5 portal doc slots
    docType: text("doc_type").notNull(),

    // Blob storage pointer (Azure)
    blobPath: text("blob_path").notNull(),
    blobUrl: text("blob_url"),

    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    sha256Hex: text("sha256_hex"),

    // Indexing lifecycle
    indexingStatus: text("indexing_status").notNull().default("not_indexed"),
    lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true }),
    lastError: text("last_error"),

    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    trainingDocsBizIdx: index("training_documents_business_id_idx").on(t.businessId),
    trainingDocsBizTypeUx: uniqueIndex("training_documents_business_doc_type_ux").on(t.businessId, t.docType),
  }),
);

export const ragJobs = pgTable(
  "rag_jobs",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict", onUpdate: "cascade" }),

    docType: text("doc_type").notNull(),
    trainingDocumentId: text("training_document_id").references(() => trainingDocuments.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => ({
    ragJobsBizIdx: index("rag_jobs_business_id_idx").on(t.businessId),
    ragJobsStatusIdx: index("rag_jobs_status_idx").on(t.status),
    ragJobsCreatedIdx: index("rag_jobs_created_at_idx").on(t.createdAt),
  }),
);

export type TrainingDocumentRow = typeof trainingDocuments.$inferSelect;
export type NewTrainingDocument = typeof trainingDocuments.$inferInsert;

export type RagJobRow = typeof ragJobs.$inferSelect;
export type NewRagJob = typeof ragJobs.$inferInsert;
