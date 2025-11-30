import { pgTable, text, boolean, timestamp, numeric, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  phoneNumber: text("phone_number"),
  whatsappConnected: boolean("whatsapp_connected").notNull().default(false),
  // Demo/business mapping
  businessId: text("business_id"), // e.g., "social", "default"
  // Booking config per user
  unitCapacity: integer("unit_capacity").default(1), // how many units per slot (tables, rooms, etc.)
  timeslotMinutes: integer("timeslot_minutes").default(60), // duration of a slot
  openTime: text("open_time"), // e.g., "09:00" in 24h
  closeTime: text("close_time"), // e.g., "18:00"
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
