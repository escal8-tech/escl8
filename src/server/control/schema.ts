import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

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
