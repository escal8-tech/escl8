import { pgTable, text, boolean, timestamp, numeric } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  phoneNumber: text("phone_number"),
  whatsappConnected: boolean("whatsapp_connected").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RequestRow = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
