/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import {
  supportTicketEvents,
} from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { normalizeKey } from "@/server/services/ticketWorkflowSupport";
import {
  getHydratedTicketByIdForBusiness,
  getTicketPerformanceForBusiness,
  getTicketTypeCountersForBusiness,
  listTicketLedgerForBusiness,
  listTicketTypesForBusiness,
  listTicketsForBusiness,
} from "@/server/services/ticketReadSupport";
import * as ticketMutationSupport from "@/server/services/ticketMutationSupport";

const ticketStatusSchema = z.enum(["open", "in_progress", "resolved"]);
const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const ticketOutcomeSchema = z.enum(["pending", "won", "lost"]);
const supportResolutionSchema = z.enum(["completed", "failed"]);
const supportStateFilterSchema = z.enum(["open", "completed", "failed"]);
const supportTagFilterSchema = z.enum([
  "COMPLAINT",
  "REFUND",
  "WARRANTY",
  "RETURN_EXCHANGE",
  "REPAIR",
  "DELIVERY",
  "PAYMENT",
  "ORDER_CHANGE",
  "MEETUP",
  "INVOICE_RECEIPT",
  "SUPPORT",
]);
const visibleSupportTicketTypeKeys = new Set(["complaint", "generalsupport"]);
const manualOrderChannelSchema = z.enum(["walkin", "phone", "website", "other"]);
const orderStageSchema = z.enum([
  "pending_approval",
  "edit_required",
  "approved",
  "awaiting_payment",
  "payment_submitted",
  "payment_rejected",
  "paid",
  "refund_pending",
  "refunded",
  "denied",
]);

export const ticketsRouter = router({
  listTypes: businessProcedure
    .input(z.object({ includeDisabled: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await listTicketTypesForBusiness({ businessId: ctx.businessId, includeDisabled: input?.includeDisabled });
      return rows.filter((row) => visibleSupportTicketTypeKeys.has(normalizeKey(row.key)));
    }),

  upsertType: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean().optional(),
        requiredFields: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ticketMutationSupport.upsertType(ctx, input)),

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
    .query(async ({ ctx, input }) => listTicketsForBusiness({ businessId: ctx.businessId, status: input?.status, typeKey: input?.typeKey, limit: input?.limit })),

  listTicketLedger: businessProcedure
    .input(
      z.object({
        typeKey: z.string().optional(),
        status: ticketStatusSchema.optional(),
        supportState: supportStateFilterSchema.optional(),
        supportTag: supportTagFilterSchema.optional(),
        orderStage: orderStageSchema.optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => listTicketLedgerForBusiness({ businessId: ctx.businessId, ...input })),

  getTicketById: businessProcedure
    .input(z.object({ ticketId: z.string().min(1) }))
    .query(async ({ ctx, input }) => getHydratedTicketByIdForBusiness({ businessId: ctx.businessId, ticketId: input.ticketId })),

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
        slaDueAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ticketMutationSupport.createTicket(ctx, input)),

  createManualOrderTicket: businessProcedure
    .input(
      z.object({
        channel: manualOrderChannelSchema.default("walkin"),
        customerName: z.string().trim().min(1).max(160),
        customerPhone: z.string().trim().max(40).optional(),
        customerEmail: z.string().trim().email().or(z.literal("")).optional(),
        priority: ticketPrioritySchema.default("urgent"),
        notes: z.string().trim().max(2000).optional(),
        deliveryArea: z.string().trim().max(240).optional(),
        shippingAddress: z.string().trim().max(1000).optional(),
        lineItems: z
          .array(
            z.object({
              item: z.string().trim().min(1).max(240),
              quantity: z.string().trim().max(20).optional(),
              unitPrice: z.string().trim().max(40).optional(),
            }),
          )
          .min(1)
          .max(20),
        total: z.string().trim().max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ticketMutationSupport.createManualOrderTicket(ctx, input)),

  updateTicket: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        title: z.string().nullish(),
        summary: z.string().nullish(),
        notes: z.string().nullish(),
        priority: ticketPrioritySchema.optional(),
        customerName: z.string().nullish(),
        customerPhone: z.string().nullish(),
        fields: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ticketMutationSupport.updateTicket(ctx, input)),

  updateTicketStatus: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        status: ticketStatusSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ticketMutationSupport.updateTicketStatus(ctx, input)),

  updateTicketOutcome: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        outcome: ticketOutcomeSchema,
        lossReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ticketMutationSupport.updateTicketOutcome(ctx, input)),

  resolveSupportTicket: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        resolution: supportResolutionSchema,
        failureReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ticketMutationSupport.resolveSupportTicket(ctx, input)),

  updateTicketSlaDueAt: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        slaDueAt: z.coerce.date().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => ticketMutationSupport.updateTicketSlaDueAt(ctx, input)),

  approveOrderTicket: businessProcedure
    .input(z.object({ id: z.string().min(1), expectedUpdatedAt: z.coerce.date().optional() }))
    .mutation(async ({ ctx, input }) => ticketMutationSupport.approveOrderTicket(ctx, input)),

  denyOrderTicket: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ticketMutationSupport.denyOrderTicket(ctx, input)),

  listTicketEvents: businessProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(supportTicketEvents)
        .where(and(eq(supportTicketEvents.businessId, ctx.businessId), eq(supportTicketEvents.ticketId, input.ticketId)))
        .orderBy(desc(supportTicketEvents.createdAt))
        .limit(input.limit ?? 100);
    }),

  getTypeCounters: businessProcedure.query(async ({ ctx }) => getTicketTypeCountersForBusiness(ctx.businessId)),

  getPerformance: businessProcedure
    .input(
      z
        .object({
          typeKey: z.string().optional(),
          windowDays: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => getTicketPerformanceForBusiness({ businessId: ctx.businessId, typeKey: input?.typeKey, windowDays: input?.windowDays })),
});
