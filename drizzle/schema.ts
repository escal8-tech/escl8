import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

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
