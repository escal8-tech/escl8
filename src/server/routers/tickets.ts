/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import {
  businesses,
  customers,
  orders,
  orderPayments,
  requests,
  supportTicketEvents,
  supportTicketTypes,
  supportTickets,
} from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import { resolveInitialFulfillmentStatus } from "@/lib/order-operations";
import { DEFAULT_TICKET_TYPE_KEYS, ensureDefaultTicketTypes } from "../services/ticketDefaults";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { drainBusinessOutbox, enqueueEmailOutboxMessages, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import {
  buildOrderApprovalEmail,
  buildOrderApprovalMessages,
  buildOrderDeliveryDetailsRequestMessages,
  computeOrderExpectedAmount,
  extractOrderFulfillmentSeed,
  formatOrderItemsSummary,
  logOrderEvent,
  missingRequiredOrderDeliveryFields,
  parseMoneyValue,
  sanitizePhoneDigits,
} from "../services/orderFlow";
import {
  asRecord,
  assertTicketAwaitingOrderDecision,
  buildOrderDenialMessages,
  coalesceText,
  enforceOrderTicketOperationThrottle,
  extractCustomerEmail,
  flushBusinessOutbox,
  getSlaDueAt,
  getThreadWhatsappWindowState,
  lockWorkflowKey,
  logTicketEvent,
  maskPhoneNumber,
  normalizeKey,
  publishHydratedTicketUpsert,
  resolveTicketContactContext,
  sanitizeTicketFields,
  validateTicketOrderFlow,
} from "@/server/services/ticketWorkflowSupport";
import {
  getHydratedTicketByIdForBusiness,
  getTicketPerformanceForBusiness,
  getTicketTypeCountersForBusiness,
  listTicketLedgerForBusiness,
  listTicketTypesForBusiness,
  listTicketsForBusiness,
} from "@/server/services/ticketReadSupport";

const ticketStatusSchema = z.enum(["open", "in_progress", "resolved"]);
const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const ticketOutcomeSchema = z.enum(["pending", "won", "lost"]);
const supportResolutionSchema = z.enum(["completed", "failed"]);
const supportStateFilterSchema = z.enum(["open", "completed", "failed"]);
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

function normalizeOptionalText(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeManualExternalId(input: {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
}) {
  const phone = sanitizePhoneDigits(input.phone);
  if (phone) return phone;
  const email = String(input.email ?? "").trim().toLowerCase();
  if (email) return email;
  const name = String(input.name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `manual-${name || randomUUID().slice(0, 8)}-${Date.now()}`;
}

function parseManualQuantity(value: string | undefined): string {
  const parsed = Number(String(value ?? "1").replace(/[^\d]/g, "") || "1");
  return String(Math.max(1, Number.isFinite(parsed) ? parsed : 1));
}

function buildManualOrderFields(input: {
  channel: z.infer<typeof manualOrderChannelSchema>;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  notes?: string | null;
  deliveryArea?: string | null;
  shippingAddress?: string | null;
  lineItems: Array<{ item: string; quantity?: string; unitPrice?: string }>;
  total?: string | null;
}) {
  const lineItems = input.lineItems
    .map((line) => {
      const item = String(line.item ?? "").trim();
      if (!item) return null;
      const quantity = parseManualQuantity(line.quantity);
      const unitPrice = parseMoneyValue(line.unitPrice);
      const row: Record<string, unknown> = { item, quantity };
      if (unitPrice) {
        row.unit_price = unitPrice;
        row.line_total = (Number(unitPrice) * Number(quantity)).toFixed(2);
      }
      return row;
    })
    .filter((line): line is Record<string, unknown> => Boolean(line));
  const pricedLineItems = lineItems.filter((line) => typeof line.unit_price === "string");
  const total =
    parseMoneyValue(input.total) ??
    (pricedLineItems.length === lineItems.length && lineItems.length
      ? lineItems.reduce((sum, line) => sum + Number(line.line_total ?? 0), 0).toFixed(2)
      : null);

  return {
    manual_order: true,
    manual_channel: input.channel,
    staff_created: true,
    suppress_customer_notifications: true,
    name: input.customerName,
    customer_name: input.customerName,
    phone: normalizeOptionalText(input.customerPhone),
    customer_phone: normalizeOptionalText(input.customerPhone),
    email: normalizeOptionalText(input.customerEmail),
    customer_email: normalizeOptionalText(input.customerEmail),
    items: lineItems.map((line) => String(line.item)),
    product: String(lineItems[0]?.item ?? ""),
    quantity: lineItems.map((line) => String(line.quantity ?? "1")),
    line_items: lineItems,
    ...(pricedLineItems.length === lineItems.length && lineItems.length ? { priced_line_items: lineItems } : {}),
    ...(total ? { total } : {}),
    ...(normalizeOptionalText(input.shippingAddress) ? { shipping_address: normalizeOptionalText(input.shippingAddress) } : {}),
    ...(normalizeOptionalText(input.deliveryArea) ? { delivery_area: normalizeOptionalText(input.deliveryArea) } : {}),
    ...(normalizeOptionalText(input.notes) ? { internal_notes: normalizeOptionalText(input.notes) } : {}),
  };
}

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
      if (updated) {
        recordBusinessEvent({
          event: "ticket.type_updated",
          action: "upsertType",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket_type",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          status: updated.enabled ? "enabled" : "disabled",
          attributes: {
            key: updated.key,
            required_fields_count: Array.isArray(updated.requiredFields) ? updated.requiredFields.length : 0,
          },
        });
      }
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
    .query(async ({ ctx, input }) => listTicketsForBusiness({ businessId: ctx.businessId, status: input?.status, typeKey: input?.typeKey, limit: input?.limit })),

  listTicketLedger: businessProcedure
    .input(
      z.object({
        typeKey: z.string().optional(),
        status: ticketStatusSchema.optional(),
        supportState: supportStateFilterSchema.optional(),
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
      const contactContext = await resolveTicketContactContext({
        businessId: ctx.businessId,
        customerId: input.customerId ?? null,
        threadId: input.threadId ?? null,
        whatsappIdentityId: input.whatsappIdentityId ?? null,
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
      });
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
          customerId: contactContext.customerId,
          threadId: contactContext.threadId,
          whatsappIdentityId: contactContext.whatsappIdentityId,
          customerName: contactContext.customerName,
          customerPhone: contactContext.customerPhone,
          fields: sanitizeTicketFields(input.fields ?? {}),
          notes: input.notes?.trim() || null,
          createdBy: input.createdBy ?? "user",
          outcome: "pending",
          lossReason: null,
          slaDueAt: input.slaDueAt ?? getSlaDueAt(input.priority ?? "normal"),
        })
        .returning();
      if (created) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: created.id,
          eventType: "created",
          actorType: input.createdBy === "bot" ? "bot" : "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? input.createdBy ?? "system",
          payload: {
            status: created.status,
            priority: created.priority,
            outcome: created.outcome,
            slaDueAt: created.slaDueAt ? new Date(created.slaDueAt).toISOString() : null,
          },
        });
        await publishHydratedTicketUpsert({
          businessId: ctx.businessId,
          ticketId: created.id,
          createdAt: created.updatedAt ?? created.createdAt ?? new Date(),
        });
        recordBusinessEvent({
          event: "ticket.created",
          action: "createTicket",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket",
          entityId: created.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: input.createdBy === "bot" ? "bot" : "user",
          outcome: "success",
          status: created.status,
          attributes: {
            outcome: created.outcome,
            priority: created.priority,
            source: created.source,
            ticket_type_key: created.ticketTypeKey,
            customer_phone_saved: Boolean(contactContext.customerPhone),
            customer_phone_source: contactContext.recipientSource,
          },
        });
      }
      return created;
    }),

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
    .mutation(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const now = new Date();
      const phoneDigits = sanitizePhoneDigits(input.customerPhone);
      const customerEmail = normalizeOptionalText(input.customerEmail);
      const externalId = normalizeManualExternalId({
        phone: phoneDigits,
        email: customerEmail,
        name: input.customerName,
      });
      const fields = buildManualOrderFields({
        channel: input.channel,
        customerName: input.customerName,
        customerPhone: phoneDigits,
        customerEmail,
        notes: input.notes,
        deliveryArea: input.deliveryArea,
        shippingAddress: input.shippingAddress,
        lineItems: input.lineItems,
        total: input.total,
      });
      const expectedAmount = computeOrderExpectedAmount(fields);
      const summary = `Manual ${input.channel} order: ${formatOrderItemsSummary(fields)}`;

      const result = await db.transaction(async (tx) => {
        const [typeRow] = await tx
          .select()
          .from(supportTicketTypes)
          .where(and(eq(supportTicketTypes.businessId, ctx.businessId), eq(supportTicketTypes.key, "ordercreation")))
          .limit(1);
        if (!typeRow) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Order ticket type is not configured." });
        }

        const [existingCustomer] = await tx
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.businessId, ctx.businessId),
              eq(customers.source, "other"),
              eq(customers.externalId, externalId),
            ),
          )
          .limit(1);

        const nextTags = Array.from(new Set([...(existingCustomer?.tags ?? []), "manual", input.channel]));
        const [customerRow] = existingCustomer
          ? await tx
              .update(customers)
              .set({
                name: input.customerName,
                phone: phoneDigits || existingCustomer.phone,
                email: customerEmail ?? existingCustomer.email,
                tags: nextTags,
                botPaused: true,
                status: "active",
                updatedAt: now,
              })
              .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, existingCustomer.id)))
              .returning()
          : await tx
              .insert(customers)
              .values({
                businessId: ctx.businessId,
                source: "other",
                externalId,
                name: input.customerName,
                phone: phoneDigits || null,
                email: customerEmail,
                tags: ["manual", input.channel],
                botPaused: true,
                status: "active",
                platformMeta: {
                  source: "manual_order",
                  channel: input.channel,
                  suppressCustomerNotifications: true,
                },
                firstMessageAt: now,
                lastMessageAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
        if (!customerRow) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create manual customer." });
        }

        const [ticketRow] = await tx
          .insert(supportTickets)
          .values({
            businessId: ctx.businessId,
            ticketTypeId: typeRow.id,
            ticketTypeKey: "ordercreation",
            title: `Manual order - ${input.customerName}`,
            summary,
            status: "open",
            priority: input.priority,
            source: "staff_manual",
            customerId: customerRow.id,
            threadId: null,
            whatsappIdentityId: null,
            customerName: input.customerName,
            customerPhone: phoneDigits || null,
            fields: sanitizeTicketFields(fields),
            notes: normalizeOptionalText(input.notes),
            createdBy: "user",
            outcome: "pending",
            slaDueAt: getSlaDueAt(input.priority),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!ticketRow) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create manual order ticket." });
        }

        const [requestRow] = await tx
          .insert(requests)
          .values({
            businessId: ctx.businessId,
            customerId: customerRow.id,
            customerNumber: phoneDigits || null,
            source: "other",
            sourceMeta: {
              source: "manual_order",
              channel: input.channel,
              ticketId: ticketRow.id,
              suppressCustomerNotifications: true,
            },
            sentiment: "neutral",
            status: "ongoing",
            type: "high_intent_lead",
            price: expectedAmount ?? "0",
            paid: false,
            summary,
            botVersion: "staff_manual",
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        const [finalCustomerRow] = await tx
          .update(customers)
          .set({
            totalRequests: sql`${customers.totalRequests} + 1`,
            leadScore: sql`${customers.leadScore} + 20`,
            isHighIntent: true,
            updatedAt: now,
          })
          .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, customerRow.id)))
          .returning();

        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: ticketRow.id,
          eventType: "created",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            source: "staff_manual",
            channel: input.channel,
            customerId: customerRow.id,
            requestId: requestRow?.id ?? null,
            suppressCustomerNotifications: true,
          },
        });

        return { customerRow: finalCustomerRow ?? customerRow, ticketRow, requestRow: requestRow ?? null };
      });

      await Promise.all([
        publishPortalEvent({
          businessId: ctx.businessId,
          entity: "customer",
          op: "upsert",
          entityId: result.customerRow.id,
          payload: { customer: JSON.parse(JSON.stringify(result.customerRow)) as any },
          createdAt: result.customerRow.updatedAt ?? now,
        }),
        publishHydratedTicketUpsert({
          businessId: ctx.businessId,
          ticketId: result.ticketRow.id,
          createdAt: result.ticketRow.updatedAt ?? now,
        }),
        result.requestRow
          ? publishPortalEvent({
              businessId: ctx.businessId,
              entity: "request",
              op: "upsert",
              entityId: result.requestRow.id,
              payload: { request: JSON.parse(JSON.stringify(result.requestRow)) as any },
              createdAt: result.requestRow.updatedAt ?? now,
            })
          : Promise.resolve(null),
      ]);

      recordBusinessEvent({
        event: "ticket.manual_order_created",
        action: "createManualOrderTicket",
        area: "ticket",
        businessId: ctx.businessId,
        entity: "ticket",
        entityId: result.ticketRow.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        attributes: {
          source: "staff_manual",
          channel: input.channel,
          customer_id: result.customerRow.id,
          request_id: result.requestRow?.id ?? null,
          expected_amount: expectedAmount,
        },
      });

      return {
        ticket: result.ticketRow,
        customer: result.customerRow,
        request: result.requestRow,
      };
    }),

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
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [existing] = await db
        .select()
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      const nextFields = sanitizeTicketFields(input.fields ?? asRecord(existing.fields));
      const nextCustomerEmail = extractCustomerEmail(nextFields);
      const [updated] = await db
        .update(supportTickets)
        .set({
          title: input.title === undefined ? existing.title : input.title?.trim() || null,
          summary: input.summary === undefined ? existing.summary : input.summary?.trim() || null,
          notes: input.notes === undefined ? existing.notes : input.notes?.trim() || null,
          priority: input.priority ?? existing.priority,
          customerName:
            input.customerName === undefined ? existing.customerName : input.customerName?.trim() || null,
          customerPhone:
            input.customerPhone === undefined ? existing.customerPhone : input.customerPhone?.trim() || null,
          fields: nextFields,
          updatedAt: now,
        })
        .where(
          and(
            eq(supportTickets.id, input.id),
            eq(supportTickets.businessId, ctx.businessId),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update ticket.",
        });
      }

      let updatedDraftOrder: { id: string; updatedAt: Date | string | null } | null = null;
      if (normalizeKey(updated.ticketTypeKey) === "ordercreation") {
        const ticketSnapshot = {
          ticketId: updated.id,
          title: updated.title ?? null,
          summary: updated.summary ?? null,
          fields: nextFields,
          notes: updated.notes ?? null,
          priority: updated.priority ?? null,
        };
        const [draftOrder] = await db
          .select({
            id: orders.id,
          })
          .from(orders)
          .where(
            and(
              eq(orders.businessId, ctx.businessId),
              eq(orders.supportTicketId, updated.id),
              eq(orders.status, "pending_approval"),
            ),
          )
          .limit(1);

        if (draftOrder) {
          const [draftOrderRow] = await db
            .update(orders)
            .set({
              customerName: updated.customerName,
              customerPhone: updated.customerPhone,
              customerEmail: nextCustomerEmail,
              ticketSnapshot,
              notes: updated.notes?.trim() || null,
              updatedAt: now,
            })
            .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, draftOrder.id)))
            .returning({
              id: orders.id,
              updatedAt: orders.updatedAt,
            });
          if (draftOrderRow) updatedDraftOrder = draftOrderRow;
        }

        if (updated.customerId) {
          await db
            .update(customers)
            .set({
              name: updated.customerName,
              phone: updated.customerPhone,
              email: nextCustomerEmail,
              updatedAt: now,
            })
            .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, updated.customerId)));
        }
      }

      await logTicketEvent({
        businessId: ctx.businessId,
        ticketId: updated.id,
        eventType: "edited",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          fieldsUpdated: input.fields ? Object.keys(input.fields) : [],
          priority: updated.priority,
        },
      });
      if (updatedDraftOrder) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: updatedDraftOrder.id,
          eventType: "draft_updated",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            supportTicketId: updated.id,
          },
        });
      }
      await Promise.all([
        publishHydratedTicketUpsert({
          businessId: ctx.businessId,
          ticketId: updated.id,
          createdAt: updated.updatedAt ?? updated.createdAt ?? now,
        }),
        updatedDraftOrder
          ? publishPortalEvent({
              businessId: ctx.businessId,
              entity: "order",
              op: "upsert",
              entityId: updatedDraftOrder.id,
              payload: { order: { id: updatedDraftOrder.id } as any },
              createdAt: updatedDraftOrder.updatedAt ?? now,
            })
          : Promise.resolve(false),
      ]);
      recordBusinessEvent({
        event: "ticket.updated",
        action: "updateTicket",
        area: "ticket",
        businessId: ctx.businessId,
        entity: "ticket",
        entityId: updated.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        status: updated.status,
        attributes: {
          priority: updated.priority,
          ticket_type_key: updated.ticketTypeKey,
        },
      });

      return updated;
    }),

  updateTicketStatus: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        status: ticketStatusSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const nextStatus = input.status;
      const [existing] = await db
        .select({
          status: supportTickets.status,
          resolvedAt: supportTickets.resolvedAt,
          outcome: supportTickets.outcome,
          lossReason: supportTickets.lossReason,
          updatedAt: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      const [updated] = await db
        .update(supportTickets)
        .set({
          status: nextStatus,
          notes: input.notes?.trim() || null,
          resolvedAt: nextStatus === "resolved" ? now : null,
          outcome: nextStatus === "resolved" ? sql`${supportTickets.outcome}` : "pending",
          lossReason: nextStatus === "resolved" ? sql`${supportTickets.lossReason}` : null,
          closedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(supportTickets.id, input.id),
            eq(supportTickets.businessId, ctx.businessId),
          ),
        )
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update ticket status.",
        });
      }
      if (existing.status !== updated.status) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: updated.id,
          eventType: "status_changed",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            from: existing.status,
            to: updated.status,
            resolvedAt: updated.resolvedAt ? new Date(updated.resolvedAt).toISOString() : null,
          },
        });
      }
      await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: updated.id,
        createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
      });
      if (existing.status !== updated.status) {
        recordBusinessEvent({
          event: "ticket.status_updated",
          action: "updateTicketStatus",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          status: updated.status,
          attributes: {
            from_status: existing.status,
            to_status: updated.status,
          },
        });
      }
      return updated;
    }),

  updateTicketOutcome: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        outcome: ticketOutcomeSchema,
        lossReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({
          status: supportTickets.status,
          outcome: supportTickets.outcome,
          lossReason: supportTickets.lossReason,
          updatedAt: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      if (existing.status !== "resolved" && input.outcome !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only resolved tickets can be marked won/lost." });
      }
      const normalizedLossReason = input.lossReason?.trim() || null;
      if (input.outcome === "lost" && !normalizedLossReason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Loss reason is required when outcome is lost." });
      }

      const [updated] = await db
        .update(supportTickets)
        .set({
          outcome: input.outcome,
          lossReason: input.outcome === "lost" ? normalizedLossReason : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supportTickets.id, input.id),
            eq(supportTickets.businessId, ctx.businessId),
          ),
        )
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update ticket outcome.",
        });
      }

      if (existing.outcome !== updated.outcome || (existing.lossReason ?? "") !== (updated.lossReason ?? "")) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: updated.id,
          eventType: "outcome_changed",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            from: existing.outcome,
            to: input.outcome,
            previousLossReason: existing.lossReason ?? null,
            lossReason: input.outcome === "lost" ? normalizedLossReason : null,
          },
        });
      }
      await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: updated.id,
        createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
      });
      if (existing.outcome !== updated.outcome || (existing.lossReason ?? "") !== (updated.lossReason ?? "")) {
        recordBusinessEvent({
          event: "ticket.outcome_updated",
          action: "updateTicketOutcome",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          status: updated.outcome,
          attributes: {
            from_outcome: existing.outcome,
            loss_reason: updated.lossReason,
            to_outcome: updated.outcome,
          },
        });
      }
      return updated;
    }),

  resolveSupportTicket: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        resolution: supportResolutionSchema,
        failureReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [existing] = await db
        .select({
          ticketTypeKey: supportTickets.ticketTypeKey,
          status: supportTickets.status,
          outcome: supportTickets.outcome,
          lossReason: supportTickets.lossReason,
          updatedAt: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      if (normalizeKey(existing.ticketTypeKey) === "ordercreation") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Order tickets use the order approval workflow." });
      }

      const nextOutcome = input.resolution === "completed" ? "won" : "lost";
      const nextLossReason =
        input.resolution === "failed"
          ? normalizeOptionalText(input.failureReason) || normalizeOptionalText(existing.lossReason) || "Not completable"
          : null;

      const [updated] = await db
        .update(supportTickets)
        .set({
          status: "resolved",
          resolvedAt: now,
          closedAt: now,
          outcome: nextOutcome,
          lossReason: nextLossReason,
          updatedAt: now,
        })
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update ticket resolution.",
        });
      }

      if (existing.status !== updated.status) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: updated.id,
          eventType: "status_changed",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            from: existing.status,
            to: updated.status,
            resolvedAt: updated.resolvedAt ? new Date(updated.resolvedAt).toISOString() : null,
          },
        });
      }

      if (existing.outcome !== updated.outcome || (existing.lossReason ?? "") !== (updated.lossReason ?? "")) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: updated.id,
          eventType: "outcome_changed",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            from: existing.outcome,
            to: updated.outcome,
            previousLossReason: existing.lossReason ?? null,
            lossReason: updated.lossReason ?? null,
            resolution: input.resolution,
          },
        });
      }

      await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: updated.id,
        createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
      });

      recordBusinessEvent({
        event: "ticket.resolution_updated",
        action: "resolveSupportTicket",
        area: "ticket",
        businessId: ctx.businessId,
        entity: "ticket",
        entityId: updated.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        status: updated.outcome,
        attributes: {
          resolution: input.resolution,
          loss_reason: updated.lossReason,
          previous_outcome: existing.outcome,
          previous_status: existing.status,
        },
      });

      return updated;
    }),

  updateTicketSlaDueAt: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        slaDueAt: z.coerce.date().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({ slaDueAt: supportTickets.slaDueAt, updatedAt: supportTickets.updatedAt })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      const [updated] = await db
        .update(supportTickets)
        .set({
          slaDueAt: input.slaDueAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supportTickets.id, input.id),
            eq(supportTickets.businessId, ctx.businessId),
          ),
        )
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update ticket SLA.",
        });
      }

      const fromIso = existing.slaDueAt ? new Date(existing.slaDueAt).toISOString() : null;
      const toIso = updated.slaDueAt ? new Date(updated.slaDueAt).toISOString() : null;
      if (fromIso !== toIso) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: updated.id,
          eventType: "sla_changed",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            from: fromIso,
            to: toIso,
          },
        });
      }
      await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: updated.id,
        createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
      });
      if (fromIso !== toIso) {
        recordBusinessEvent({
          event: "ticket.sla_updated",
          action: "updateTicketSlaDueAt",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          attributes: {
            from_sla_due_at: fromIso,
            to_sla_due_at: toIso,
          },
        });
      }
      return updated;
    }),

  approveOrderTicket: businessProcedure
    .input(z.object({ id: z.string().min(1), expectedUpdatedAt: z.coerce.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [biz] = await db
        .select({ settings: businesses.settings })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);
      const orderSettings = normalizeOrderFlowSettings(biz?.settings);

      const [ticket] = await db
        .select({
          id: supportTickets.id,
          businessId: supportTickets.businessId,
          ticketTypeKey: supportTickets.ticketTypeKey,
          status: supportTickets.status,
          outcome: supportTickets.outcome,
          source: supportTickets.source,
          customerId: supportTickets.customerId,
          threadId: supportTickets.threadId,
          whatsappIdentityId: supportTickets.whatsappIdentityId,
          customerName: supportTickets.customerName,
          customerPhone: supportTickets.customerPhone,
          title: supportTickets.title,
          summary: supportTickets.summary,
          fields: supportTickets.fields,
          notes: supportTickets.notes,
          priority: supportTickets.priority,
          createdBy: supportTickets.createdBy,
          createdAt: supportTickets.createdAt,
          updatedAt: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);

      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      validateTicketOrderFlow({
        ticketTypeKey: ticket.ticketTypeKey,
        ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
      });
      assertTicketAwaitingOrderDecision({
        status: ticket.status,
        outcome: ticket.outcome,
      });

      const fields = asRecord(ticket.fields);
      const suppressCustomerNotifications =
        String(ticket.source || "").trim().toLowerCase() === "staff_manual" ||
        fields.manual_order === true ||
        fields.suppress_customer_notifications === true;
      const requestedCustomerEmail = extractCustomerEmail(fields);
      const itemsSummary = formatOrderItemsSummary(fields);
      const expectedAmount = computeOrderExpectedAmount(fields);
      if (orderSettings.paymentMethod === "bank_qr" && !expectedAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bank or QR order approval requires a verified payable amount.",
        });
      }
      const contactContext = await resolveTicketContactContext({
        businessId: ctx.businessId,
        customerId: ticket.customerId,
        threadId: ticket.threadId,
        whatsappIdentityId: ticket.whatsappIdentityId,
        customerName: ticket.customerName,
        customerPhone: ticket.customerPhone,
      });
      const customerEmail = coalesceText(requestedCustomerEmail, contactContext.customerEmail);
      const approvalRecipient = sanitizePhoneDigits(contactContext.approvalRecipient);
      const now = new Date();
      const initialFulfillmentStatus = resolveInitialFulfillmentStatus(orderSettings.paymentMethod);
      const ticketSnapshot = {
        ticketId: ticket.id,
        title: ticket.title ?? null,
        summary: ticket.summary ?? null,
        fields,
        notes: ticket.notes ?? null,
        priority: ticket.priority ?? null,
      };

      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::ticket::${ticket.id}`);
        await enforceOrderTicketOperationThrottle(tx, ctx, "approve", ticket.id);

        const [currentTicket] = await tx
          .select({
            id: supportTickets.id,
            ticketTypeKey: supportTickets.ticketTypeKey,
            status: supportTickets.status,
            outcome: supportTickets.outcome,
          })
          .from(supportTickets)
          .where(and(eq(supportTickets.id, ticket.id), eq(supportTickets.businessId, ctx.businessId)))
          .limit(1);
        if (!currentTicket) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
        }
        validateTicketOrderFlow({
          ticketTypeKey: currentTicket.ticketTypeKey,
          ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
        });
        assertTicketAwaitingOrderDecision({
          status: currentTicket.status,
          outcome: currentTicket.outcome,
        });
        const windowState = await getThreadWhatsappWindowState(tx, contactContext.threadId);
        const shouldSendApprovalViaWhatsapp = !suppressCustomerNotifications && windowState.whatsappWindowOpen;
        if (shouldSendApprovalViaWhatsapp && (!contactContext.whatsappIdentityId || !approvalRecipient)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ticket is missing WhatsApp routing details for payment delivery.",
          });
        }

        const [existingOrder] = await tx
          .select({
            id: orders.id,
            status: orders.status,
            paymentReference: orders.paymentReference,
            customerEmail: orders.customerEmail,
          })
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.supportTicketId, ticket.id)))
          .limit(1);
        if (existingOrder && !["pending_approval", "edit_required"].includes(String(existingOrder.status || "").trim().toLowerCase())) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Ticket already has a linked order (${existingOrder.status || "existing"}) and cannot be approved again.`,
          });
        }
        const effectiveCustomerEmail = coalesceText(customerEmail, existingOrder?.customerEmail);
        if (!suppressCustomerNotifications && !shouldSendApprovalViaWhatsapp && !effectiveCustomerEmail) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Order approval requires the customer's email after the WhatsApp window closes.",
          });
        }

        const fulfillmentSeed = extractOrderFulfillmentSeed({
          fields,
          customerName: contactContext.customerName ?? ticket.customerName,
          customerPhone: contactContext.customerPhone ?? ticket.customerPhone,
          useContactFallback: !shouldSendApprovalViaWhatsapp,
        });
        const missingDeliveryFields =
          shouldSendApprovalViaWhatsapp && orderSettings.paymentMethod === "bank_qr"
            ? missingRequiredOrderDeliveryFields({
                recipientName: fulfillmentSeed.recipientName,
                recipientPhone: fulfillmentSeed.recipientPhone,
                shippingAddress: fulfillmentSeed.shippingAddress,
              })
            : [];
        const shouldCollectDeliveryDetails =
          shouldSendApprovalViaWhatsapp &&
          orderSettings.paymentMethod === "bank_qr" &&
          missingDeliveryFields.length > 0;
        const nextOrderStatus =
          shouldCollectDeliveryDetails
            ? "approved"
            : orderSettings.paymentMethod === "bank_qr"
              ? "awaiting_payment"
              : "approved";

        const orderId = existingOrder?.id ?? randomUUID();
        const paymentReference =
          orderSettings.paymentMethod === "bank_qr"
            ? coalesceText(existingOrder?.paymentReference, `ORD-${orderId.slice(0, 8).toUpperCase()}`)
            : null;
        const paymentConfigSnapshot = {
          paymentMethod: orderSettings.paymentMethod,
          currency: orderSettings.currency,
          bankQr: orderSettings.bankQr,
          deliveryDetailsCollectionRequired: shouldCollectDeliveryDetails,
          deliveryDetailsMissingFields: missingDeliveryFields,
        };

        const baseOrderValues = {
          businessId: ctx.businessId,
          supportTicketId: ticket.id,
          source: ticket.source || "whatsapp",
          customerId: contactContext.customerId,
          threadId: contactContext.threadId,
          whatsappIdentityId: contactContext.whatsappIdentityId,
          customerName: contactContext.customerName,
          customerPhone: contactContext.customerPhone,
          customerEmail: effectiveCustomerEmail,
          status: nextOrderStatus,
          fulfillmentStatus: initialFulfillmentStatus,
          fulfillmentUpdatedAt: now,
          recipientName: fulfillmentSeed.recipientName,
          recipientPhone: fulfillmentSeed.recipientPhone,
          shippingAddress: fulfillmentSeed.shippingAddress,
          deliveryArea: fulfillmentSeed.deliveryArea,
          deliveryNotes: fulfillmentSeed.deliveryNotes,
          paymentMethod: orderSettings.paymentMethod,
          currency: orderSettings.currency,
          expectedAmount,
          paymentReference,
          ticketSnapshot,
          paymentConfigSnapshot,
          notes: ticket.notes?.trim() || null,
          approvedAt: now,
          updatedAt: now,
        } as const;

        const [orderRow] = existingOrder
          ? await tx
              .update(orders)
              .set(baseOrderValues)
              .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, existingOrder.id)))
              .returning()
          : await tx
              .insert(orders)
              .values({
                id: orderId,
                ...baseOrderValues,
              })
              .returning();

        if (contactContext.customerId && effectiveCustomerEmail) {
          await tx
            .update(customers)
            .set({
              email: effectiveCustomerEmail,
              updatedAt: now,
            })
            .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, contactContext.customerId)));
        }

        let resumedCustomer: typeof customers.$inferSelect | null = null;
        let previousCustomerBotPaused = false;
        if (contactContext.customerId) {
          const [existingCustomer] = await tx
            .select({
              botPaused: customers.botPaused,
            })
            .from(customers)
            .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, contactContext.customerId)))
            .limit(1);
          previousCustomerBotPaused = Boolean(existingCustomer?.botPaused);
          if (previousCustomerBotPaused) {
            [resumedCustomer] = await tx
              .update(customers)
              .set({
                botPaused: false,
                updatedAt: now,
              })
              .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, contactContext.customerId)))
              .returning();
          }
        }

        const [ticketRow] = await tx
          .update(supportTickets)
          .set({
            customerId: contactContext.customerId,
            threadId: contactContext.threadId,
            whatsappIdentityId: contactContext.whatsappIdentityId,
            customerName: contactContext.customerName,
            customerPhone: contactContext.customerPhone,
            status: "resolved",
            outcome: "won",
            lossReason: null,
            resolvedAt: now,
            closedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(supportTickets.id, ticket.id),
              eq(supportTickets.businessId, ctx.businessId),
            ),
          )
          .returning();

        if (!ticketRow) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to approve order ticket.",
          });
        }

        const approvalMessages = buildOrderApprovalMessages({
          orderId: orderRow?.id ?? orderId,
          customerName: contactContext.customerName ?? ticket.customerName,
          itemsSummary,
          expectedAmount,
          paymentReference: orderRow?.paymentReference ?? paymentReference,
          orderSettings,
        });
        const deliveryDetailsMessages = buildOrderDeliveryDetailsRequestMessages({
          orderId: orderRow?.id ?? orderId,
          itemsSummary,
          expectedAmount,
          currency: orderSettings.currency,
          missingFields: missingDeliveryFields,
        });
        const approvalEmail = buildOrderApprovalEmail({
          orderId: orderRow?.id ?? orderId,
          customerName: contactContext.customerName ?? ticket.customerName,
          itemsSummary,
          expectedAmount,
          paymentReference: orderRow?.paymentReference ?? paymentReference,
          orderSettings,
        });
        const notification = shouldSendApprovalViaWhatsapp
          ? await enqueueWhatsAppOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: orderRow?.id ?? orderId,
              customerId: contactContext.customerId,
              threadId: contactContext.threadId,
              whatsappIdentityId: contactContext.whatsappIdentityId,
              recipient: contactContext.approvalRecipient,
              recipientSource: contactContext.recipientSource,
              whatsappIdentitySource: contactContext.whatsappIdentitySource,
              source: "order_ticket_approval",
              idempotencyBaseKey: `order_ticket:${ticket.id}:approval:${orderRow?.id ?? orderId}`,
              messages: shouldCollectDeliveryDetails ? deliveryDetailsMessages : approvalMessages,
            })
          : {
              ok: true as const,
              error: null,
              recipientSource: null,
              whatsappIdentitySource: null,
              idempotencyKeys: [] as string[],
            };
        const emailNotification = shouldSendApprovalViaWhatsapp || suppressCustomerNotifications
          ? {
              ok: true as const,
              error: null,
              idempotencyKeys: [] as string[],
            }
          : await enqueueEmailOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: orderRow?.id ?? orderId,
              customerId: contactContext.customerId,
              recipientEmail: effectiveCustomerEmail,
              source: "order_ticket_approval_email",
              idempotencyBaseKey: `order_ticket:${ticket.id}:approval_email:${orderRow?.id ?? orderId}`,
              messages: [approvalEmail],
            });
        const deliveryChannel: "whatsapp" | "email" | "none" = suppressCustomerNotifications
          ? "none"
          : shouldSendApprovalViaWhatsapp
            ? "whatsapp"
            : "email";

        return {
          order: orderRow ?? null,
          ticket: ticketRow ?? null,
          notification,
          emailNotification,
          deliveryChannel,
          windowState,
          customerPause: {
            row: resumedCustomer,
            previousBotPaused: previousCustomerBotPaused,
          },
        };
      });

      if (!result.order || !result.ticket) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to approve order ticket." });
      }

      await Promise.all([
        logTicketEvent({
          businessId: ctx.businessId,
          ticketId: result.ticket.id,
          eventType: "order_approved",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            orderId: result.order.id,
            orderStatus: result.order.status,
            paymentMethod: result.order.paymentMethod,
          },
        }),
        logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.order.id,
          eventType: "approved",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            supportTicketId: result.ticket.id,
            paymentMethod: result.order.paymentMethod,
            expectedAmount: result.order.expectedAmount,
            recipient: maskPhoneNumber(approvalRecipient),
            recipientSource: contactContext.recipientSource,
            whatsappIdentitySource: contactContext.whatsappIdentitySource,
            suppressCustomerNotifications,
          },
        }),
      ]);

      let delivery: {
        ok: boolean;
        error: string | null;
        channel: "whatsapp" | "email" | "none";
        recipientSource: string | null;
        whatsappIdentitySource: string | null;
      } = {
        ok: true,
        error: null,
        channel: result.deliveryChannel,
        recipientSource: result.notification.recipientSource,
        whatsappIdentitySource: result.notification.whatsappIdentitySource,
      };
      if (result.deliveryChannel === "none") {
        delivery = {
          ok: true,
          error: null,
          channel: "none",
          recipientSource: null,
          whatsappIdentitySource: null,
        };
      } else if (result.deliveryChannel === "whatsapp" && !result.notification.ok) {
        delivery = {
          ok: false,
          error: result.notification.error,
          channel: "whatsapp",
          recipientSource: result.notification.recipientSource,
          whatsappIdentitySource: result.notification.whatsappIdentitySource,
        };
      } else if (result.deliveryChannel === "email" && !result.emailNotification.ok) {
        delivery = {
          ok: false,
          error: result.emailNotification.error,
          channel: "email",
          recipientSource: null,
          whatsappIdentitySource: null,
        };
      } else {
        const idempotencyKeys =
          result.deliveryChannel === "whatsapp"
            ? result.notification.idempotencyKeys
            : result.emailNotification.idempotencyKeys;
        if (idempotencyKeys.length) {
          const drained = await drainBusinessOutbox({
            businessId: ctx.businessId,
            idempotencyKeys,
            limit: idempotencyKeys.length,
          });
          delivery = {
            ok: drained.ok,
            error: drained.error,
            channel: result.deliveryChannel,
            recipientSource: result.deliveryChannel === "whatsapp" ? result.notification.recipientSource : null,
            whatsappIdentitySource:
              result.deliveryChannel === "whatsapp" ? result.notification.whatsappIdentitySource : null,
          };
        }
      }
      await flushBusinessOutbox(ctx.businessId);
      if (!delivery.ok) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.order.id,
          eventType: orderSettings.paymentMethod === "bank_qr"
            ? "payment_instructions_delivery_failed"
            : "order_approval_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            error: delivery.error,
          },
        });
      }

      const [realtimeTicket] = await Promise.all([
        publishHydratedTicketUpsert({
          businessId: ctx.businessId,
          ticketId: result.ticket.id,
          createdAt: result.ticket.updatedAt ?? now,
        }),
        publishPortalEvent({
          businessId: ctx.businessId,
          entity: "order",
          op: "upsert",
          entityId: result.order.id,
          payload: { order: result.order as any },
          createdAt: result.order.updatedAt ?? now,
        }),
      ]);
      if (result.customerPause?.row) {
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "customer",
          op: "upsert",
          entityId: result.customerPause.row.id,
          payload: {
            customer: JSON.parse(JSON.stringify(result.customerPause.row)) as any,
          },
          createdAt: result.customerPause.row.updatedAt ?? now,
        });
      }

      recordBusinessEvent({
        event: "ticket.order_approved",
        action: "approveOrderTicket",
        area: "ticket",
        businessId: ctx.businessId,
        entity: "ticket",
        entityId: result.ticket.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.order.status,
        attributes: {
          delivery_ok: delivery.ok,
          delivery_channel: delivery.channel,
          order_id: result.order.id,
          payment_method: result.order.paymentMethod,
          suppress_customer_notifications: suppressCustomerNotifications,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return {
        ticket: realtimeTicket ?? result.ticket,
        order: result.order,
        delivery,
      };
    }),

  denyOrderTicket: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [biz] = await db
        .select({ settings: businesses.settings })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);
      const orderSettings = normalizeOrderFlowSettings(biz?.settings);

      const [ticket] = await db
        .select({
          id: supportTickets.id,
          businessId: supportTickets.businessId,
          ticketTypeKey: supportTickets.ticketTypeKey,
          status: supportTickets.status,
          outcome: supportTickets.outcome,
          source: supportTickets.source,
          customerId: supportTickets.customerId,
          threadId: supportTickets.threadId,
          whatsappIdentityId: supportTickets.whatsappIdentityId,
          customerName: supportTickets.customerName,
          customerPhone: supportTickets.customerPhone,
          notes: supportTickets.notes,
          updatedAt: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      validateTicketOrderFlow({
        ticketTypeKey: ticket.ticketTypeKey,
        ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
      });
      assertTicketAwaitingOrderDecision({
        status: ticket.status,
        outcome: ticket.outcome,
      });

      const now = new Date();
      const normalizedReason = input.reason?.trim() || "Denied";
      const contactContext = await resolveTicketContactContext({
        businessId: ctx.businessId,
        customerId: ticket.customerId,
        threadId: ticket.threadId,
        whatsappIdentityId: ticket.whatsappIdentityId,
        customerName: ticket.customerName,
        customerPhone: ticket.customerPhone,
      });
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::ticket::${input.id}`);
        await enforceOrderTicketOperationThrottle(tx, ctx, "deny", input.id);

        const [currentTicket] = await tx
          .select({
            id: supportTickets.id,
            ticketTypeKey: supportTickets.ticketTypeKey,
            status: supportTickets.status,
            outcome: supportTickets.outcome,
          })
          .from(supportTickets)
          .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
          .limit(1);
        if (!currentTicket) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
        }
        validateTicketOrderFlow({
          ticketTypeKey: currentTicket.ticketTypeKey,
          ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
        });
        assertTicketAwaitingOrderDecision({
          status: currentTicket.status,
          outcome: currentTicket.outcome,
        });

        const [existingOrder] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.supportTicketId, input.id)))
          .limit(1);
        let deniedOrder: typeof orders.$inferSelect | null = null;
        if (existingOrder) {
          await tx
            .update(orderPayments)
            .set({
              status: "rejected",
              aiCheckNotes: normalizedReason,
              updatedAt: now,
            })
            .where(
              and(
                eq(orderPayments.businessId, ctx.businessId),
                eq(orderPayments.orderId, existingOrder.id),
                eq(orderPayments.status, "submitted"),
              ),
            );

          const [updatedOrder] = await tx
            .update(orders)
            .set({
              status: "denied",
              paymentApprovedAt: null,
              paymentRejectedAt: now,
              updatedAt: now,
            })
            .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, existingOrder.id)))
            .returning();
          deniedOrder = updatedOrder ?? existingOrder;
        }

        const [ticketRow] = await tx
          .update(supportTickets)
          .set({
            status: "resolved",
            outcome: "lost",
            lossReason: normalizedReason,
            resolvedAt: now,
            closedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(supportTickets.id, input.id),
              eq(supportTickets.businessId, ctx.businessId),
            ),
          )
          .returning();

        if (!ticketRow) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to deny order ticket.",
          });
        }

        const notification = await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "ticket",
          entityId: input.id,
          customerId: contactContext.customerId,
          threadId: contactContext.threadId,
          whatsappIdentityId: contactContext.whatsappIdentityId,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: "order_ticket_denied",
          idempotencyBaseKey: `order_ticket:${input.id}:denial`,
          messages: buildOrderDenialMessages({
            customerName: contactContext.customerName ?? ticket.customerName,
            reason: normalizedReason,
          }),
        });

        return {
          ticket: ticketRow ?? null,
          order: deniedOrder,
          notification,
        };
      });

      if (!result.ticket) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to deny order ticket." });
      }

      await logTicketEvent({
        businessId: ctx.businessId,
        ticketId: result.ticket.id,
        eventType: "order_denied",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          reason: normalizedReason,
          orderId: result.order?.id ?? null,
        },
      });
      if (result.order) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.order.id,
          eventType: "denied",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            reason: normalizedReason,
            supportTicketId: result.ticket.id,
          },
        });
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "order",
          op: "upsert",
          entityId: result.order.id,
          payload: {
            order: result.order as any,
          },
          createdAt: result.order.updatedAt ?? now,
        });
      }

      let delivery: {
        ok: boolean;
        error: string | null;
        recipientSource: string | null;
        whatsappIdentitySource: string | null;
      } = {
        ok: true,
        error: null,
        recipientSource: result.notification.recipientSource,
        whatsappIdentitySource: result.notification.whatsappIdentitySource,
      };
      if (!result.notification.ok) {
        delivery = {
          ok: false,
          error: result.notification.error,
          recipientSource: result.notification.recipientSource,
          whatsappIdentitySource: result.notification.whatsappIdentitySource,
        };
      } else if (result.notification.idempotencyKeys.length) {
        const drained = await drainBusinessOutbox({
          businessId: ctx.businessId,
          idempotencyKeys: result.notification.idempotencyKeys,
          limit: result.notification.idempotencyKeys.length,
        });
        delivery = {
          ok: drained.ok,
          error: drained.error,
          recipientSource: result.notification.recipientSource,
          whatsappIdentitySource: result.notification.whatsappIdentitySource,
        };
      }
      await flushBusinessOutbox(ctx.businessId);
      if (!delivery.ok) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: result.ticket.id,
          eventType: "order_denial_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            error: delivery.error,
          },
        });
      }

      const realtimeTicket = await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: result.ticket.id,
        createdAt: result.ticket.updatedAt ?? now,
      });

      recordBusinessEvent({
        event: "ticket.order_denied",
        action: "denyOrderTicket",
        area: "ticket",
        businessId: ctx.businessId,
        entity: "ticket",
        entityId: result.ticket.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: "denied",
        attributes: {
          order_id: result.order?.id ?? null,
          reason: normalizedReason,
          delivery_ok: delivery.ok,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return {
        ...result,
        ticket: realtimeTicket ?? result.ticket,
        delivery,
      };
    }),

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
