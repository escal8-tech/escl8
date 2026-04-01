import { pgTable, text, boolean, integer, timestamp, jsonb, uniqueIndex, index, numeric, check, foreignKey } from "drizzle-orm/pg-core";
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
    suiteTenantId: text("suite_tenant_id"),
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
    gmailConnected: boolean("gmail_connected").notNull().default(false),
    gmailEmail: text("gmail_email"),
    gmailRefreshToken: text("gmail_refresh_token"),
    gmailAccessToken: text("gmail_access_token"),
    gmailAccessTokenExpiresAt: timestamp("gmail_access_token_expires_at", { withTimezone: true }),
    gmailScope: text("gmail_scope"),
    gmailConnectedAt: timestamp("gmail_connected_at", { withTimezone: true }),
    gmailError: text("gmail_error"),
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
    firebaseUid: text("firebase_uid").notNull(), // global Firebase user identity
    suiteUserId: text("suite_user_id"),

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
    usersFirebaseUidUx: uniqueIndex("users_firebase_uid_ux").on(t.firebaseUid),
    usersBusinessIdIdx: index("users_business_id_idx").on(t.businessId),
    usersSuiteUserIdIdx: index("users_suite_user_id_idx").on(t.suiteUserId),
    usersIdNonEmpty: check("users_id_nonempty", sql`length(btrim(${t.id})) > 0`),
    usersEmailNonEmpty: check("users_email_nonempty", sql`length(btrim(${t.email})) > 0`),
    usersFirebaseUidNonEmpty: check("users_firebase_uid_nonempty", sql`length(btrim(${t.firebaseUid})) > 0`),
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

    // Which bot type this number is connected to (default to AGENT for existing rows).
    botType: text("bot_type").notNull().default("AGENT"),

    // Optional debug/admin fields
    wabaId: text("waba_id"),
    displayPhoneNumber: text("display_phone_number"),

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
    waIdentitiesBotTypeValid: check(
      "wa_identities_bot_type_valid",
      sql`${t.botType} in ('AGENT', 'CONCIERGE', 'RESERVATION')`,
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
  messageThreads: many(messageThreads),
  requests: many(requests),
  supportTicketTypes: many(supportTicketTypes),
  supportTickets: many(supportTickets),
  orders: many(orders),
  orderPayments: many(orderPayments),
  orderEvents: many(orderEvents),
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

    // Which phone number / WhatsApp identity this customer contacted (nullable for non-WhatsApp sources)
    whatsappIdentityId: text("whatsapp_identity_id"),
    
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
    botPaused: boolean("bot_paused").notNull().default(false),
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
    // Unique constraint: business + source + externalId + whatsappIdentityId (one customer per channel per phone number)
    // For WhatsApp: same person messaging 2 different business phone numbers = 2 customer rows
    customersCompositeUx: uniqueIndex("customers_composite_ux").on(t.businessId, t.source, t.externalId, t.whatsappIdentityId),
    
    // Fast lookups
    customersBusinessIdx: index("customers_business_id_idx").on(t.businessId),
    customersWhatsappIdentityIdx: index("customers_whatsapp_identity_id_idx").on(t.whatsappIdentityId),
    customersSourceIdx: index("customers_source_idx").on(t.source),
    customersBusinessSourceIdx: index("customers_business_source_idx").on(t.businessId, t.source),
    customersExternalIdIdx: index("customers_external_id_idx").on(t.externalId),
    customersLastMessageIdx: index("customers_last_message_at_idx").on(t.lastMessageAt),
    customersLeadScoreIdx: index("customers_lead_score_idx").on(t.leadScore),
    customersHighIntentIdx: index("customers_high_intent_idx").on(t.businessId, t.isHighIntent),
    customersTotalRevenueIdx: index("customers_total_revenue_idx").on(t.businessId, t.totalRevenue),
    customersBotPausedIdx: index("customers_bot_paused_idx").on(t.businessId, t.botPaused),
    // Soft delete filter
    customersDeletedAtIdx: index("customers_deleted_at_idx").on(t.deletedAt),
    customersWhatsappIdentityFk: foreignKey({
      name: "customers_whatsapp_identity_fk",
      columns: [t.whatsappIdentityId],
      foreignColumns: [whatsappIdentities.phoneNumberId],
    }).onDelete("set null").onUpdate("cascade"),

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

/**
 * MESSAGE THREADS = canonical conversation container.
 *
 * Requirements:
 * - each thread belongs to exactly 1 business
 * - each thread belongs to exactly 1 customer (customer is already scoped to business)
 * - messages belong to exactly 1 thread
 */
export const messageThreads = pgTable(
  "message_threads",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict", onUpdate: "cascade" }),

    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade", onUpdate: "cascade" }),

    // Which phone number / WhatsApp identity this thread is for
    whatsappIdentityId: text("whatsapp_identity_id"),

    // one thread per (business, customer, whatsappIdentityId) - allows same customer to have threads with different phone numbers
    status: text("status").notNull().default("open"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),

    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),

    // Soft delete (optional)
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    messageThreadsBusinessCustomerIdentityUx: uniqueIndex("message_threads_business_customer_identity_ux").on(
      t.businessId,
      t.customerId,
      t.whatsappIdentityId,
    ),
    messageThreadsBusinessIdx: index("message_threads_business_id_idx").on(t.businessId),
    messageThreadsCustomerIdx: index("message_threads_customer_id_idx").on(t.customerId),
    messageThreadsWhatsappIdentityIdx: index("message_threads_whatsapp_identity_id_idx").on(t.whatsappIdentityId),
    messageThreadsLastMessageIdx: index("message_threads_last_message_at_idx").on(t.lastMessageAt),
    messageThreadsDeletedAtIdx: index("message_threads_deleted_at_idx").on(t.deletedAt),
    messageThreadsWhatsappIdentityFk: foreignKey({
      name: "message_threads_whatsapp_identity_fk",
      columns: [t.whatsappIdentityId],
      foreignColumns: [whatsappIdentities.phoneNumberId],
    }).onDelete("set null").onUpdate("cascade"),
  }),
);

/**
 * THREAD MESSAGES = individual message records.
 *
 * Keep this minimal; store raw payloads only if you need them.
 */
export const threadMessages = pgTable(
  "thread_messages",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    threadId: text("thread_id")
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade", onUpdate: "cascade" }),

    // Platform message id (Meta message id, IG message id, etc.) for idempotency.
    externalMessageId: text("external_message_id"),

    direction: text("direction").notNull(), // inbound | outbound
    messageType: text("message_type"), // text | audio | image | etc.
    textBody: text("text_body"),

    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    threadMessagesThreadIdx: index("thread_messages_thread_id_idx").on(t.threadId),
    threadMessagesCreatedIdx: index("thread_messages_created_at_idx").on(t.createdAt),
    threadMessagesThreadDirectionCreatedIdx: index("thread_messages_thread_direction_created_idx").on(t.threadId, t.direction, t.createdAt),
    // Only enforce uniqueness when we actually have an external id.
    threadMessagesExternalUx: uniqueIndex("thread_messages_external_message_id_ux")
      .on(t.externalMessageId)
      .where(sql`${t.externalMessageId} is not null`),
  }),
);

export const messageThreadsRelations = relations(messageThreads, ({ one, many }) => ({
  business: one(businesses, {
    fields: [messageThreads.businessId],
    references: [businesses.id],
  }),
  customer: one(customers, {
    fields: [messageThreads.customerId],
    references: [customers.id],
  }),
  whatsappIdentity: one(whatsappIdentities, {
    fields: [messageThreads.whatsappIdentityId],
    references: [whatsappIdentities.phoneNumberId],
  }),
  messages: many(threadMessages),
  supportTickets: many(supportTickets),
  orders: many(orders),
  orderPayments: many(orderPayments),
}));

export const threadMessagesRelations = relations(threadMessages, ({ one }) => ({
  thread: one(messageThreads, {
    fields: [threadMessages.threadId],
    references: [messageThreads.id],
  }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  business: one(businesses, {
    fields: [customers.businessId],
    references: [businesses.id],
  }),
  whatsappIdentity: one(whatsappIdentities, {
    fields: [customers.whatsappIdentityId],
    references: [whatsappIdentities.phoneNumberId],
  }),
  assignedTo: one(users, {
    fields: [customers.assignedToUserId],
    references: [users.id],
  }),
  threads: many(messageThreads),
  requests: many(requests),
  supportTickets: many(supportTickets),
  orders: many(orders),
  orderPayments: many(orderPayments),
}));

export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

// Tenant-defined ticket categories + required flow-state fields.
export const supportTicketTypes = pgTable(
  "support_ticket_types",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade", onUpdate: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    requiredFields: jsonb("required_fields").$type<string[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    supportTicketTypesBizIdx: index("support_ticket_types_business_id_idx").on(t.businessId),
    supportTicketTypesEnabledIdx: index("support_ticket_types_enabled_idx").on(t.businessId, t.enabled),
    supportTicketTypesBizKeyUx: uniqueIndex("support_ticket_types_business_key_ux").on(t.businessId, t.key),
    supportTicketTypesKeyNonEmpty: check(
      "support_ticket_types_key_nonempty",
      sql`length(btrim(${t.key})) > 0`,
    ),
    supportTicketTypesLabelNonEmpty: check(
      "support_ticket_types_label_nonempty",
      sql`length(btrim(${t.label})) > 0`,
    ),
  }),
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade", onUpdate: "cascade" }),
    ticketTypeId: text("ticket_type_id").references(() => supportTicketTypes.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    ticketTypeKey: text("ticket_type_key").notNull(),
    status: text("status").notNull().default("open"), // open | in_progress | resolved | closed
    priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
    outcome: text("outcome").notNull().default("pending"), // pending | won | lost
    lossReason: text("loss_reason"),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    source: text("source").notNull().default("whatsapp"),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    threadId: text("thread_id").references(() => messageThreads.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    whatsappIdentityId: text("whatsapp_identity_id"),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    idempotencyKey: text("idempotency_key"),
    title: text("title"),
    summary: text("summary"),
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull().default({}),
    notes: text("notes"),
    createdBy: text("created_by").notNull().default("bot"), // bot | user | system
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    supportTicketsBizIdx: index("support_tickets_business_id_idx").on(t.businessId),
    supportTicketsTypeIdx: index("support_tickets_type_idx").on(t.businessId, t.ticketTypeKey),
    supportTicketsStatusIdx: index("support_tickets_status_idx").on(t.businessId, t.status),
    supportTicketsOutcomeIdx: index("support_tickets_outcome_idx").on(t.businessId, t.outcome),
    supportTicketsTypeUpdatedCreatedIdx: index("support_tickets_type_updated_created_idx").on(t.businessId, t.ticketTypeKey, t.updatedAt, t.createdAt),
    supportTicketsStatusUpdatedCreatedIdx: index("support_tickets_status_updated_created_idx").on(t.businessId, t.status, t.updatedAt, t.createdAt),
    supportTicketsOutcomeUpdatedIdx: index("support_tickets_outcome_updated_idx").on(t.businessId, t.outcome, t.updatedAt),
    supportTicketsSlaDueIdx: index("support_tickets_sla_due_at_idx").on(t.slaDueAt),
    supportTicketsCreatedIdx: index("support_tickets_created_at_idx").on(t.createdAt),
    supportTicketsCustomerIdx: index("support_tickets_customer_id_idx").on(t.customerId),
    supportTicketsIdempotencyUx: uniqueIndex("support_tickets_business_idempotency_uk")
      .on(t.businessId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    supportTicketsWhatsappIdentityFk: foreignKey({
      name: "support_tickets_whatsapp_identity_fk",
      columns: [t.whatsappIdentityId],
      foreignColumns: [whatsappIdentities.phoneNumberId],
    }).onDelete("set null").onUpdate("cascade"),
  }),
);

export const messageOutbox = pgTable(
  "message_outbox",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade", onUpdate: "cascade" }),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    threadId: text("thread_id").references(() => messageThreads.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    whatsappIdentityId: text("whatsapp_identity_id"),
    recipient: text("recipient"),
    channel: text("channel").notNull().default("whatsapp"),
    source: text("source").notNull().default("system"),
    messageType: text("message_type").notNull().default("text"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    providerResponse: jsonb("provider_response").$type<Record<string, unknown> | null>().default(null),
    idempotencyKey: text("idempotency_key").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    messageOutboxBusinessStatusIdx: index("message_outbox_status_idx").on(t.businessId, t.status, t.createdAt),
    messageOutboxEntityIdx: index("message_outbox_entity_idx").on(t.businessId, t.entityType, t.entityId, t.createdAt),
    messageOutboxThreadIdx: index("message_outbox_thread_idx").on(t.threadId, t.createdAt),
    messageOutboxIdempotencyUx: uniqueIndex("message_outbox_business_idempotency_uk").on(t.businessId, t.idempotencyKey),
    messageOutboxWhatsappIdentityFk: foreignKey({
      name: "message_outbox_whatsapp_identity_fk",
      columns: [t.whatsappIdentityId],
      foreignColumns: [whatsappIdentities.phoneNumberId],
    }).onDelete("set null").onUpdate("cascade"),
  }),
);

export const operationThrottles = pgTable(
  "operation_throttles",
  {
    scopeKey: text("scope_key").primaryKey().notNull(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade", onUpdate: "cascade" }),
    bucket: text("bucket").notNull(),
    hitCount: integer("hit_count").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationThrottlesBusinessBucketIdx: index("operation_throttles_business_bucket_idx").on(t.businessId, t.bucket, t.resetAt),
    operationThrottlesResetIdx: index("operation_throttles_reset_at_idx").on(t.resetAt),
  }),
);

export const orders = pgTable(
  "orders",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade", onUpdate: "cascade" }),
    supportTicketId: text("support_ticket_id").references(() => supportTickets.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    source: text("source").notNull().default("whatsapp"),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    threadId: text("thread_id").references(() => messageThreads.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    whatsappIdentityId: text("whatsapp_identity_id"),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    status: text("status").notNull().default("approved"),
    fulfillmentStatus: text("fulfillment_status").notNull().default("queued"),
    fulfillmentUpdatedAt: timestamp("fulfillment_updated_at", { withTimezone: true }),
    recipientName: text("recipient_name"),
    recipientPhone: text("recipient_phone"),
    shippingAddress: text("shipping_address"),
    deliveryArea: text("delivery_area"),
    deliveryNotes: text("delivery_notes"),
    courierName: text("courier_name"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    dispatchReference: text("dispatch_reference"),
    scheduledDeliveryAt: timestamp("scheduled_delivery_at", { withTimezone: true }),
    fulfillmentNotes: text("fulfillment_notes"),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    outForDeliveryAt: timestamp("out_for_delivery_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedDeliveryAt: timestamp("failed_delivery_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    paymentMethod: text("payment_method").notNull().default("manual"),
    currency: text("currency").notNull().default("LKR"),
    expectedAmount: numeric("expected_amount", { precision: 12, scale: 2 }),
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }),
    paymentReference: text("payment_reference"),
    ticketSnapshot: jsonb("ticket_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    paymentConfigSnapshot: jsonb("payment_config_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    notes: text("notes"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paymentApprovedAt: timestamp("payment_approved_at", { withTimezone: true }),
    paymentRejectedAt: timestamp("payment_rejected_at", { withTimezone: true }),
    invoiceNumber: text("invoice_number"),
    invoiceUrl: text("invoice_url"),
    invoiceStoragePath: text("invoice_storage_path"),
    invoiceFileName: text("invoice_file_name"),
    invoiceStatus: text("invoice_status").notNull().default("not_sent"),
    invoiceDeliveryMethod: text("invoice_delivery_method"),
    invoiceGeneratedAt: timestamp("invoice_generated_at", { withTimezone: true }),
    invoiceSentAt: timestamp("invoice_sent_at", { withTimezone: true }),
    refundRequestedAt: timestamp("refund_requested_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundAmount: numeric("refund_amount", { precision: 12, scale: 2 }),
    refundReason: text("refund_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ordersBusinessIdx: index("orders_business_id_idx").on(t.businessId),
    ordersStatusIdx: index("orders_status_idx").on(t.businessId, t.status),
    ordersFulfillmentStatusIdx: index("orders_fulfillment_status_idx").on(t.businessId, t.fulfillmentStatus),
    ordersBusinessUpdatedCreatedIdx: index("orders_business_updated_created_idx").on(t.businessId, t.updatedAt, t.createdAt),
    ordersBusinessCreatedIdx: index("orders_business_created_idx").on(t.businessId, t.createdAt),
    ordersBusinessMethodUpdatedCreatedIdx: index("orders_business_method_updated_created_idx").on(t.businessId, t.paymentMethod, t.updatedAt, t.createdAt),
    ordersBusinessMethodCreatedIdx: index("orders_business_method_created_idx").on(t.businessId, t.paymentMethod, t.createdAt),
    ordersCustomerIdx: index("orders_customer_id_idx").on(t.customerId),
    ordersTicketUx: uniqueIndex("orders_support_ticket_id_ux").on(t.supportTicketId).where(sql`${t.supportTicketId} is not null`),
    ordersWhatsappIdentityFk: foreignKey({
      name: "orders_whatsapp_identity_fk",
      columns: [t.whatsappIdentityId],
      foreignColumns: [whatsappIdentities.phoneNumberId],
    }).onDelete("set null").onUpdate("cascade"),
  }),
);

export const orderPayments = pgTable(
  "order_payments",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade", onUpdate: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade", onUpdate: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    threadId: text("thread_id").references(() => messageThreads.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    whatsappIdentityId: text("whatsapp_identity_id"),
    paymentMethod: text("payment_method").notNull().default("bank_qr"),
    status: text("status").notNull().default("submitted"),
    currency: text("currency").notNull().default("LKR"),
    expectedAmount: numeric("expected_amount", { precision: 12, scale: 2 }),
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }),
    paidDate: text("paid_date"),
    referenceCode: text("reference_code"),
    proofUrl: text("proof_url"),
    aiCheckStatus: text("ai_check_status"),
    aiCheckNotes: text("ai_check_notes"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderPaymentsBusinessIdx: index("order_payments_business_id_idx").on(t.businessId),
    orderPaymentsOrderIdx: index("order_payments_order_id_idx").on(t.orderId),
    orderPaymentsStatusIdx: index("order_payments_status_idx").on(t.businessId, t.status),
    orderPaymentsCreatedIdx: index("order_payments_created_at_idx").on(t.createdAt),
    orderPaymentsBusinessOrderCreatedIdx: index("order_payments_business_order_created_idx").on(t.businessId, t.orderId, t.createdAt),
    orderPaymentsWhatsappIdentityFk: foreignKey({
      name: "order_payments_whatsapp_identity_fk",
      columns: [t.whatsappIdentityId],
      foreignColumns: [whatsappIdentities.phoneNumberId],
    }).onDelete("set null").onUpdate("cascade"),
  }),
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade", onUpdate: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade", onUpdate: "cascade" }),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull().default("system"),
    actorId: text("actor_id"),
    actorLabel: text("actor_label"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderEventsBusinessIdx: index("order_events_business_id_idx").on(t.businessId),
    orderEventsOrderIdx: index("order_events_order_id_idx").on(t.orderId),
    orderEventsCreatedIdx: index("order_events_created_at_idx").on(t.createdAt),
  }),
);

export const supportTicketEvents = pgTable(
  "support_ticket_events",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade", onUpdate: "cascade" }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade", onUpdate: "cascade" }),
    eventType: text("event_type").notNull(), // created | status_changed | outcome_changed | sla_changed | note
    actorType: text("actor_type").notNull().default("system"), // user | bot | system
    actorId: text("actor_id"),
    actorLabel: text("actor_label"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    supportTicketEventsBizIdx: index("support_ticket_events_business_id_idx").on(t.businessId),
    supportTicketEventsTicketIdx: index("support_ticket_events_ticket_id_idx").on(t.ticketId),
    supportTicketEventsCreatedIdx: index("support_ticket_events_created_at_idx").on(t.createdAt),
  }),
);

export const supportTicketTypesRelations = relations(supportTicketTypes, ({ one, many }) => ({
  business: one(businesses, {
    fields: [supportTicketTypes.businessId],
    references: [businesses.id],
  }),
  tickets: many(supportTickets),
}));

export const supportTicketsRelations = relations(supportTickets, ({ one, many }) => ({
  business: one(businesses, {
    fields: [supportTickets.businessId],
    references: [businesses.id],
  }),
  ticketType: one(supportTicketTypes, {
    fields: [supportTickets.ticketTypeId],
    references: [supportTicketTypes.id],
  }),
  customer: one(customers, {
    fields: [supportTickets.customerId],
    references: [customers.id],
  }),
  thread: one(messageThreads, {
    fields: [supportTickets.threadId],
    references: [messageThreads.id],
  }),
  whatsappIdentity: one(whatsappIdentities, {
    fields: [supportTickets.whatsappIdentityId],
    references: [whatsappIdentities.phoneNumberId],
  }),
  events: many(supportTicketEvents),
  orders: many(orders),
}));

export const supportTicketEventsRelations = relations(supportTicketEvents, ({ one }) => ({
  business: one(businesses, {
    fields: [supportTicketEvents.businessId],
    references: [businesses.id],
  }),
  ticket: one(supportTickets, {
    fields: [supportTicketEvents.ticketId],
    references: [supportTickets.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  business: one(businesses, {
    fields: [orders.businessId],
    references: [businesses.id],
  }),
  supportTicket: one(supportTickets, {
    fields: [orders.supportTicketId],
    references: [supportTickets.id],
  }),
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  thread: one(messageThreads, {
    fields: [orders.threadId],
    references: [messageThreads.id],
  }),
  whatsappIdentity: one(whatsappIdentities, {
    fields: [orders.whatsappIdentityId],
    references: [whatsappIdentities.phoneNumberId],
  }),
  payments: many(orderPayments),
  events: many(orderEvents),
}));

export const orderPaymentsRelations = relations(orderPayments, ({ one }) => ({
  business: one(businesses, {
    fields: [orderPayments.businessId],
    references: [businesses.id],
  }),
  order: one(orders, {
    fields: [orderPayments.orderId],
    references: [orders.id],
  }),
  customer: one(customers, {
    fields: [orderPayments.customerId],
    references: [customers.id],
  }),
  thread: one(messageThreads, {
    fields: [orderPayments.threadId],
    references: [messageThreads.id],
  }),
  whatsappIdentity: one(whatsappIdentities, {
    fields: [orderPayments.whatsappIdentityId],
    references: [whatsappIdentities.phoneNumberId],
  }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  business: one(businesses, {
    fields: [orderEvents.businessId],
    references: [businesses.id],
  }),
  order: one(orders, {
    fields: [orderEvents.orderId],
    references: [orders.id],
  }),
}));

export type SupportTicketTypeRow = typeof supportTicketTypes.$inferSelect;
export type NewSupportTicketType = typeof supportTicketTypes.$inferInsert;
export type SupportTicketRow = typeof supportTickets.$inferSelect;
export type NewSupportTicket = typeof supportTickets.$inferInsert;
export type MessageOutboxRow = typeof messageOutbox.$inferSelect;
export type NewMessageOutbox = typeof messageOutbox.$inferInsert;
export type SupportTicketEventRow = typeof supportTicketEvents.$inferSelect;
export type NewSupportTicketEvent = typeof supportTicketEvents.$inferInsert;
export type OrderRow = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderPaymentRow = typeof orderPayments.$inferSelect;
export type NewOrderPayment = typeof orderPayments.$inferInsert;
export type OrderEventRow = typeof orderEvents.$inferSelect;
export type NewOrderEvent = typeof orderEvents.$inferInsert;

// Customer requests (per business dashboard) - multi-source
export const requests = pgTable(
  "requests",
  {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),

    // Tenant scope
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict", onUpdate: "cascade" }),

    // FK to customer (UUID) - whatsappIdentityId is available through customer relation
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
    status: text("status").notNull().default("ongoing"), // "ongoing" | "completed" | "failed" | "assistance_required"
    type: text("type").notNull().default("browsing"), // "high_intent_lead" | "low_intent_lead" | "browsing" | etc

    price: numeric("price", { precision: 10, scale: 2 }).default("0"),
    paid: boolean("paid").notNull().default(false),

    summary: text("summary"),
    botVersion: text("bot_version"),

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
    requestsStatusIdx: index("requests_status_idx").on(t.status),
    requestsBusinessStatusIdx: index("requests_business_status_idx").on(t.businessId, t.status),
    requestsSourceIdx: index("requests_source_idx").on(t.source),
    requestsBusinessSourceIdx: index("requests_business_source_idx").on(t.businessId, t.source),
    requestsBusinessCustomerCreatedIdx: index("requests_business_customer_created_idx").on(t.businessId, t.customerId, t.createdAt),
    requestsBusinessTypeIdx: index("requests_business_type_idx").on(t.businessId, t.type),
    requestsBusinessBotVersionIdx: index("requests_business_bot_version_idx").on(t.businessId, t.botVersion),
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

// Relations: requests -> business & customer (whatsappIdentity available through customer)
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
