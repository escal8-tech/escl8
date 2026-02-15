/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { supportTicketTypes, supportTickets } from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { DEFAULT_TICKET_TYPE_KEYS, ensureDefaultTicketTypes } from "../services/ticketDefaults";
import { publishPortalEvent } from "@/server/realtime/portalEvents";

const ticketStatusSchema = z.enum(["open", "in_progress", "resolved"]);
const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

function normalizeKey(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const ticketsRouter = router({
  listTypes: businessProcedure
    .input(z.object({ includeDisabled: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const conditions = [eq(supportTicketTypes.businessId, ctx.businessId)];
      if (!input?.includeDisabled) {
        conditions.push(eq(supportTicketTypes.enabled, true));
      }
      return db
        .select()
        .from(supportTicketTypes)
        .where(and(...conditions))
        .orderBy(supportTicketTypes.sortOrder, supportTicketTypes.label);
    }),

  upsertType: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean().optional(),
        requiredFields: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const requiredFields = (input.requiredFields ?? [])
        .map((x) => normalizeKey(x))
        .filter(Boolean);

      const [existing] = await db
        .select({ key: supportTicketTypes.key })
        .from(supportTicketTypes)
        .where(and(eq(supportTicketTypes.id, input.id), eq(supportTicketTypes.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket type not found" });
      }
      if (!DEFAULT_TICKET_TYPE_KEYS.has(existing.key as any)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only default ticket types can be edited." });
      }

      const [updated] = await db
        .update(supportTicketTypes)
        .set({
          enabled: input.enabled ?? true,
          requiredFields,
          updatedAt: new Date(),
        })
        .where(and(eq(supportTicketTypes.id, input.id), eq(supportTicketTypes.businessId, ctx.businessId)))
        .returning();
      return updated ?? null;
    }),

  deleteType: businessProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async () => {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket types are fixed. Disable instead of deleting." });
    }),

  listTickets: businessProcedure
    .input(
      z.object({
        status: ticketStatusSchema.optional(),
        typeKey: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(supportTickets.businessId, ctx.businessId)];
      if (input?.status) conditions.push(eq(supportTickets.status, input.status));
      if (input?.typeKey) conditions.push(eq(supportTickets.ticketTypeKey, normalizeKey(input.typeKey)));
      return db
        .select()
        .from(supportTickets)
        .where(and(...conditions))
        .orderBy(desc(supportTickets.createdAt))
        .limit(input?.limit ?? 200);
    }),

  createTicket: businessProcedure
    .input(
      z.object({
        ticketTypeKey: z.string().min(1),
        title: z.string().optional(),
        summary: z.string().optional(),
        status: ticketStatusSchema.optional(),
        priority: ticketPrioritySchema.optional(),
        source: z.string().optional(),
        customerId: z.string().optional(),
        threadId: z.string().optional(),
        whatsappIdentityId: z.string().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
        notes: z.string().optional(),
        createdBy: z.enum(["bot", "user", "system"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const ticketTypeKey = normalizeKey(input.ticketTypeKey);
      const [typeRow] = await db
        .select()
        .from(supportTicketTypes)
        .where(
          and(
            eq(supportTicketTypes.businessId, ctx.businessId),
            eq(supportTicketTypes.key, ticketTypeKey),
          ),
        )
        .limit(1);
      if (!typeRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid ticket type" });
      }
      const [created] = await db
        .insert(supportTickets)
        .values({
          businessId: ctx.businessId,
          ticketTypeId: typeRow.id,
          ticketTypeKey,
          title: input.title?.trim() || null,
          summary: input.summary?.trim() || null,
          status: input.status ?? "open",
          priority: input.priority ?? "normal",
          source: input.source?.trim() || "whatsapp",
          customerId: input.customerId ?? null,
          threadId: input.threadId ?? null,
          whatsappIdentityId: input.whatsappIdentityId ?? null,
          customerName: input.customerName?.trim() || null,
          customerPhone: input.customerPhone?.trim() || null,
          fields: input.fields ?? {},
          notes: input.notes?.trim() || null,
          createdBy: input.createdBy ?? "user",
        })
        .returning();
      if (created) {
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: created.id,
          payload: { ticket: created as any },
          createdAt: created.updatedAt ?? created.createdAt ?? new Date(),
        });
      }
      return created;
    }),

  updateTicketStatus: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        status: ticketStatusSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [updated] = await db
        .update(supportTickets)
        .set({
          status: input.status,
          notes: input.notes?.trim() || null,
          resolvedAt: input.status === "resolved" ? now : null,
          closedAt: null,
          updatedAt: now,
        })
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .returning();
      if (updated) {
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: updated.id,
          payload: { ticket: updated as any },
          createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
        });
      }
      return updated ?? null;
    }),
});

