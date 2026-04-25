import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

export const suiteTenants = pgTable('suite_tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  externalRef: varchar('external_ref', { length: 200 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  externalRefUniq: uniqueIndex('suite_tenants_external_ref_uniq').on(table.externalRef),
}))

export const suiteUsers = pgTable('suite_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  firebaseUid: varchar('firebase_uid', { length: 128 }).notNull().unique(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  displayName: varchar('display_name', { length: 200 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const suiteMemberships = pgTable('suite_memberships', {
  suiteTenantId: uuid('suite_tenant_id').notNull().references(() => suiteTenants.id, { onDelete: 'cascade' }),
  suiteUserId: uuid('suite_user_id').notNull().references(() => suiteUsers.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 50 }).notNull().default('member'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.suiteTenantId, table.suiteUserId] }),
  suiteUserIdx: index('suite_memberships_user_idx').on(table.suiteUserId),
}))

export const suiteEntitlements = pgTable('suite_entitlements', {
  suiteTenantId: uuid('suite_tenant_id').notNull().references(() => suiteTenants.id, { onDelete: 'cascade' }),
  module: varchar('module', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.suiteTenantId, table.module] }),
}))

export const suiteSubscriptionPlans = pgTable('suite_subscription_plans', {
  code: varchar('code', { length: 80 }).primaryKey(),
  displayName: varchar('display_name', { length: 200 }).notNull(),
  description: text('description'),
  grantKind: varchar('grant_kind', { length: 30 }).notNull().default('standard'),
  grantsAgent: boolean('grants_agent').notNull().default(false),
  grantsReservation: boolean('grants_reservation').notNull().default(false),
  billingPeriodMonths: integer('billing_period_months').notNull().default(1),
  priceAmount: integer('price_amount').notNull().default(0),
  currency: varchar('currency', { length: 12 }).notNull().default('USD'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  features: jsonb('features').$type<Record<string, boolean>>().notNull().default({}),
  limits: jsonb('limits').$type<Record<string, number | string | boolean | null>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const suiteTenantSubscriptions = pgTable('suite_tenant_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  suiteTenantId: uuid('suite_tenant_id').notNull().references(() => suiteTenants.id, { onDelete: 'cascade' }),
  planCode: varchar('plan_code', { length: 80 }).notNull().references(() => suiteSubscriptionPlans.code, { onDelete: 'restrict' }),
  status: varchar('status', { length: 40 }).notNull().default('pending_setup'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodDueAt: timestamp('current_period_due_at', { withTimezone: true }),
  lastPaidAt: timestamp('last_paid_at', { withTimezone: true }),
  nextDueAt: timestamp('next_due_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  featureOverrides: jsonb('feature_overrides').$type<Record<string, boolean>>().notNull().default({}),
  limitOverrides: jsonb('limit_overrides').$type<Record<string, number | string | boolean | null>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  suiteTenantIdx: index('suite_tenant_subscriptions_tenant_idx').on(table.suiteTenantId),
  planCodeIdx: index('suite_tenant_subscriptions_plan_idx').on(table.planCode),
  statusIdx: index('suite_tenant_subscriptions_status_idx').on(table.status),
}))

export const suiteTenantPaymentEvents = pgTable('suite_tenant_payment_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  subscriptionId: uuid('subscription_id').notNull().references(() => suiteTenantSubscriptions.id, { onDelete: 'cascade' }),
  suiteTenantId: uuid('suite_tenant_id').notNull().references(() => suiteTenants.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 40 }).notNull().default('recorded'),
  amount: integer('amount').notNull().default(0),
  currency: varchar('currency', { length: 12 }).notNull().default('USD'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  reference: varchar('reference', { length: 200 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  subscriptionIdx: index('suite_tenant_payment_events_subscription_idx').on(table.subscriptionId),
  tenantIdx: index('suite_tenant_payment_events_tenant_idx').on(table.suiteTenantId),
  statusIdx: index('suite_tenant_payment_events_status_idx').on(table.status),
}))

export const suiteAppLinks = pgTable('suite_app_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  suiteTenantId: uuid('suite_tenant_id').notNull().references(() => suiteTenants.id, { onDelete: 'cascade' }),
  sourceModule: varchar('source_module', { length: 50 }).notNull(),
  sourceEntityId: varchar('source_entity_id', { length: 200 }).notNull(),
  targetModule: varchar('target_module', { length: 50 }).notNull(),
  targetEntityId: varchar('target_entity_id', { length: 200 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueLink: uniqueIndex('suite_app_links_unique').on(
    table.suiteTenantId,
    table.sourceModule,
    table.sourceEntityId,
    table.targetModule,
    table.targetEntityId,
  ),
}))
