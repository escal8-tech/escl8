/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ORDER_FULFILLMENT_STATUSES,
  normalizeOrderFulfillmentStatus,
} from "@/lib/order-operations";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { assertExpectedUpdatedAt } from "@/server/operationalHardening";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { drainBusinessOutbox, enqueueEmailOutboxMessages, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import { db } from "../db/client";
import { businessProcedure, router } from "../trpc";
import { customers, orderPayments, orders, supportTickets } from "../../../drizzle/schema";
import {
  buildOrderApprovalEmail,
  buildOrderApprovalMessages,
  buildFulfillmentStatusMessages,
  buildManualCollectionMessages,
  buildManualCollectionEmail,
  formatOrderItemsSummary,
  logOrderEvent,
  parseMoneyValue,
  sanitizePhoneDigits,
} from "../services/orderFlow";
import { createOrderInvoiceArtifact } from "../services/orderInvoice";
import {
  ORDER_WORKSPACE_MODES,
  assertOrderAllowsFulfillmentUpdates,
  assertPaymentReviewAllowed,
  assertPaymentSetupEditable,
  asRecord,
  buildPaymentReviewEmail,
  buildPaymentReviewMessages,
  buildRefundStatusMessages,
  buildStoredOrderFlowSettings,
  canCaptureManualPayment,
  cleanOptionalText,
  cleanOptionalUrl,
  coalesceText,
  enforceOrderOperationThrottle,
  flushBusinessOutbox,
  getBusinessOrderSettings,
  getThreadWhatsappWindowState,
  lockWorkflowKey,
  maskPhoneNumber,
  nextFulfillmentTimestamps,
  parseOptionalDate,
  refreshOrderInvoiceUrl,
  resolveOrderNotificationContext,
  resolveRefundAmount,
  requiresDispatchData,
} from "@/server/services/orderWorkflowSupport";
import {
  extractCustomerEmail,
  logTicketEvent,
  publishHydratedTicketUpsert,
  sanitizeTicketFields,
} from "@/server/services/ticketWorkflowSupport";
import {
  getOrderByIdForBusiness,
  getOrderStatsForBusiness,
  getOrderWorkspaceOverviewForBusiness,
  listOrderEventsForBusiness,
  listOrderPaymentsForBusiness,
  listOrdersForBusiness,
  listOrdersPageForBusiness,
} from "@/server/services/orderReadSupport";

const reviewActionSchema = z.enum(["approve", "reject"]);
const refundActionSchema = z.enum(["mark_pending", "mark_refunded", "cancel"]);
const fulfillmentStatusSchema = z.enum(ORDER_FULFILLMENT_STATUSES);

export const ordersRouter = router({
  listOrders: businessProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(500).optional(),
          status: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => listOrdersForBusiness({ businessId: ctx.businessId, limit: input?.limit, status: input?.status })),

  listOrdersPage: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        search: z.string().optional(),
        mode: z.enum(ORDER_WORKSPACE_MODES).default("payments"),
        queueFilter: z
          .enum([
            "all",
            "pending",
            "approved",
            "denied",
            "out_for_delivery",
            "completed",
            "realized",
            "unrealized",
          ])
          .default("all"),
        dateField: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
        rangeDays: z.number().int().min(1).max(365).default(30),
        methodFilter: z.enum(["all", "manual", "bank_qr", "cod"]).default("all"),
      }),
    )
    .query(async ({ ctx, input }) => listOrdersPageForBusiness({ businessId: ctx.businessId, ...input })),

  getOverview: businessProcedure
    .input(
      z.object({
        mode: z.enum(ORDER_WORKSPACE_MODES).default("payments"),
        queueFilter: z
          .enum([
            "all",
            "pending",
            "approved",
            "denied",
            "out_for_delivery",
            "completed",
            "realized",
            "unrealized",
          ])
          .default("all"),
        dateField: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
        rangeDays: z.number().int().min(1).max(365).default(30),
        methodFilter: z.enum(["all", "manual", "bank_qr", "cod"]).default("all"),
      }),
    )
    .query(async ({ ctx, input }) => getOrderWorkspaceOverviewForBusiness({ businessId: ctx.businessId, ...input })),

  getOrderById: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => getOrderByIdForBusiness({ businessId: ctx.businessId, orderId: input.orderId })),

  getStats: businessProcedure.query(async ({ ctx }) => getOrderStatsForBusiness(ctx.businessId)),

  getOrderPayments: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => listOrderPaymentsForBusiness({ businessId: ctx.businessId, orderId: input.orderId })),

  updateDraftOrder: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        title: z.string().nullish(),
        summary: z.string().nullish(),
        notes: z.string().nullish(),
        customerName: z.string().nullish(),
        customerPhone: z.string().nullish(),
        customerEmail: z.string().nullish(),
        fields: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [orderRow] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
        .limit(1);
      if (!orderRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
      }
      if (String(orderRow.status || "").trim().toLowerCase() !== "pending_approval") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only pending approval draft orders can be edited here.",
        });
      }
      assertExpectedUpdatedAt({
        entityLabel: "order",
        expectedUpdatedAt: input.expectedUpdatedAt,
        actualUpdatedAt: orderRow.updatedAt,
      });

      const snapshot = asRecord(orderRow.ticketSnapshot);
      const baseFields = asRecord(snapshot.fields);
      const nextFieldsSeed = sanitizeTicketFields(input.fields ?? baseFields);
      const nextCustomerName = input.customerName === undefined
        ? cleanOptionalText(orderRow.customerName, 160)
        : cleanOptionalText(input.customerName, 160);
      const nextCustomerPhone = input.customerPhone === undefined
        ? cleanOptionalText(orderRow.customerPhone, 64)
        : cleanOptionalText(input.customerPhone, 64);
      const nextCustomerEmail = input.customerEmail === undefined
        ? cleanOptionalText(orderRow.customerEmail ?? extractCustomerEmail(nextFieldsSeed), 320)
        : cleanOptionalText(input.customerEmail, 320);
      const nextTitle = input.title === undefined
        ? cleanOptionalText(typeof snapshot.title === "string" ? snapshot.title : null, 240)
        : cleanOptionalText(input.title, 240);
      const nextSummary = input.summary === undefined
        ? cleanOptionalText(typeof snapshot.summary === "string" ? snapshot.summary : null, 1200)
        : cleanOptionalText(input.summary, 1200);
      const nextNotes = input.notes === undefined
        ? cleanOptionalText(orderRow.notes ?? (typeof snapshot.notes === "string" ? snapshot.notes : null), 1200)
        : cleanOptionalText(input.notes, 1200);

      const nextFields: Record<string, unknown> = { ...nextFieldsSeed };
      if (nextCustomerName) nextFields.name = nextCustomerName;
      else delete nextFields.name;
      if (nextCustomerEmail) {
        nextFields.email = nextCustomerEmail;
        nextFields.customerEmail = nextCustomerEmail;
      } else {
        delete nextFields.email;
        delete nextFields.customerEmail;
      }

      const ticketSnapshot = {
        ...snapshot,
        ticketId: orderRow.supportTicketId ?? snapshot.ticketId ?? null,
        title: nextTitle,
        summary: nextSummary,
        fields: nextFields,
        notes: nextNotes,
        priority: snapshot.priority ?? null,
      };

      const result = await db.transaction(async (tx) => {
        const [updatedOrder] = await tx
          .update(orders)
          .set({
            customerName: nextCustomerName,
            customerPhone: nextCustomerPhone,
            customerEmail: nextCustomerEmail,
            ticketSnapshot,
            notes: nextNotes,
            updatedAt: now,
          })
          .where(and(eq(orders.id, orderRow.id), eq(orders.updatedAt, orderRow.updatedAt)))
          .returning();

        if (!updatedOrder) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This draft order was updated by another staff member. Refresh and try again.",
          });
        }

        let updatedTicketId: string | null = null;
        if (orderRow.supportTicketId) {
          const [updatedTicket] = await tx
            .update(supportTickets)
            .set({
              title: nextTitle,
              summary: nextSummary,
              notes: nextNotes,
              customerName: nextCustomerName,
              customerPhone: nextCustomerPhone,
              fields: nextFields,
              updatedAt: now,
            })
            .where(and(eq(supportTickets.id, orderRow.supportTicketId), eq(supportTickets.businessId, ctx.businessId)))
            .returning({ id: supportTickets.id });
          updatedTicketId = updatedTicket?.id ?? null;
        }

        if (orderRow.customerId) {
          await tx
            .update(customers)
            .set({
              name: nextCustomerName,
              phone: nextCustomerPhone,
              email: nextCustomerEmail,
              updatedAt: now,
            })
            .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, orderRow.customerId)));
        }

        return { updatedOrder, updatedTicketId };
      });

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: "draft_updated",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          customerEmail: result.updatedOrder.customerEmail,
          customerName: result.updatedOrder.customerName,
          customerPhone: result.updatedOrder.customerPhone,
        },
      });

      if (result.updatedTicketId) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: result.updatedTicketId,
          eventType: "edited",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            syncedFromOrderDraft: true,
            fieldsUpdated: Object.keys(nextFields),
          },
        });
      }

      await Promise.all([
        publishPortalEvent({
          businessId: ctx.businessId,
          entity: "order",
          op: "upsert",
          entityId: result.updatedOrder.id,
          payload: { order: result.updatedOrder as any },
          createdAt: result.updatedOrder.updatedAt ?? now,
        }),
        result.updatedTicketId
          ? publishHydratedTicketUpsert({
              businessId: ctx.businessId,
              ticketId: result.updatedTicketId,
              createdAt: now,
            })
          : Promise.resolve(null),
      ]);

      recordBusinessEvent({
        event: "order.draft_updated",
        action: "updateDraftOrder",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: result.updatedOrder.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        status: result.updatedOrder.status,
        attributes: {
          support_ticket_id: orderRow.supportTicketId,
          ticket_synced: Boolean(result.updatedTicketId),
        },
      });

      return result.updatedOrder;
    }),

  updatePaymentSetup: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        expectedAmount: z.string().optional().nullable(),
        paymentReference: z.string().optional().nullable(),
        customerEmail: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [orderRow] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
        .limit(1);
      if (!orderRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
      }
      assertPaymentSetupEditable(orderRow);
      assertExpectedUpdatedAt({
        entityLabel: "order",
        expectedUpdatedAt: input.expectedUpdatedAt,
        actualUpdatedAt: orderRow.updatedAt,
      });

      const nextExpectedAmount = input.expectedAmount === undefined
        ? orderRow.expectedAmount?.toString() ?? null
        : parseMoneyValue(input.expectedAmount);
      const nextPaymentReference = input.paymentReference === undefined
        ? cleanOptionalText(orderRow.paymentReference, 120)
        : cleanOptionalText(input.paymentReference, 120);
      const nextCustomerEmail = input.customerEmail === undefined
        ? cleanOptionalText(orderRow.customerEmail, 320)
        : cleanOptionalText(input.customerEmail, 320);
      const nextNotes = input.notes === undefined
        ? cleanOptionalText(orderRow.notes, 1200)
        : cleanOptionalText(input.notes, 1200);

      const [updatedOrder] = await db
        .update(orders)
        .set({
          expectedAmount: nextExpectedAmount,
          paymentReference: nextPaymentReference,
          customerEmail: nextCustomerEmail,
          notes: nextNotes,
          updatedAt: now,
        })
        .where(and(eq(orders.id, orderRow.id), eq(orders.updatedAt, orderRow.updatedAt)))
        .returning();

      if (!updatedOrder) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This order was updated by another staff member. Refresh and try again.",
        });
      }

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: updatedOrder.id,
        eventType: "payment_setup_updated",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          expectedAmount: updatedOrder.expectedAmount,
          paymentReference: updatedOrder.paymentReference,
          customerEmail: updatedOrder.customerEmail,
        },
      });

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: updatedOrder.id,
        payload: { order: updatedOrder as any },
        createdAt: updatedOrder.updatedAt ?? now,
      });

      return updatedOrder;
    }),

  getOrderEvents: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => listOrderEventsForBusiness({ businessId: ctx.businessId, orderId: input.orderId })),

  sendPaymentDetails: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "sendPaymentDetails", input.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }
        if (String(orderRow.paymentMethod || "").trim().toLowerCase() !== "bank_qr") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Payment details can only be sent for Bank / QR orders." });
        }
        if (!["awaiting_payment", "payment_rejected"].includes(String(orderRow.status || "").trim().toLowerCase())) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Payment details can only be resent while the order is awaiting payment." });
        }

        const windowState = await getThreadWhatsappWindowState(tx, orderRow.threadId);

        const contactContext = await resolveOrderNotificationContext({
          businessId: ctx.businessId,
          customerId: orderRow.customerId ?? null,
          threadId: orderRow.threadId ?? null,
          whatsappIdentityId: orderRow.whatsappIdentityId ?? null,
          customerName: orderRow.customerName ?? null,
          customerEmail: orderRow.customerEmail ?? null,
          customerPhone: orderRow.customerPhone ?? null,
        });
        const shouldSendViaWhatsapp = windowState.whatsappWindowOpen;
        const recipient = sanitizePhoneDigits(contactContext.approvalRecipient);
        if (shouldSendViaWhatsapp && (!contactContext.whatsappIdentityId || !recipient)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This order is missing WhatsApp routing details." });
        }
        if (!shouldSendViaWhatsapp && !contactContext.customerEmail) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment details require the customer's email after the WhatsApp window closes.",
          });
        }

        const orderSettings = buildStoredOrderFlowSettings(orderRow);
        const snapshot = asRecord(orderRow.ticketSnapshot);
        const messages = buildOrderApprovalMessages({
          orderId: orderRow.id,
          customerName: contactContext.customerName ?? orderRow.customerName,
          itemsSummary: formatOrderItemsSummary(snapshot),
          expectedAmount: orderRow.expectedAmount?.toString() ?? null,
          paymentReference: orderRow.paymentReference,
          orderSettings,
        });
        const emailMessage = buildOrderApprovalEmail({
          orderId: orderRow.id,
          customerName: contactContext.customerName ?? orderRow.customerName,
          itemsSummary: formatOrderItemsSummary(snapshot),
          expectedAmount: orderRow.expectedAmount?.toString() ?? null,
          paymentReference: orderRow.paymentReference,
          orderSettings,
        });
        const notification = shouldSendViaWhatsapp
          ? await enqueueWhatsAppOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: orderRow.id,
              customerId: orderRow.customerId ?? null,
              threadId: contactContext.threadId ?? null,
              whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
              recipient: contactContext.approvalRecipient,
              recipientSource: contactContext.recipientSource,
              whatsappIdentitySource: contactContext.whatsappIdentitySource,
              source: "order_payment_details_manual_send",
              idempotencyBaseKey: `order:${orderRow.id}:payment_details_manual_send:${now.toISOString()}`,
              messages,
            })
          : {
              ok: true as const,
              error: null,
              recipientSource: null,
              whatsappIdentitySource: null,
              idempotencyKeys: [] as string[],
            };
        const emailNotification = shouldSendViaWhatsapp
          ? {
              ok: true as const,
              error: null,
              idempotencyKeys: [] as string[],
            }
          : await enqueueEmailOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: orderRow.id,
              customerId: orderRow.customerId ?? null,
              recipientEmail: contactContext.customerEmail,
              source: "order_payment_details_manual_send_email",
              idempotencyBaseKey: `order:${orderRow.id}:payment_details_manual_send_email:${now.toISOString()}`,
              messages: [emailMessage],
            });
        const deliveryChannel: "whatsapp" | "email" = shouldSendViaWhatsapp ? "whatsapp" : "email";

        return {
          orderRow,
          notification,
          emailNotification,
          deliveryChannel,
          windowState,
          botDisplayPhoneNumber: contactContext.whatsappIdentityId,
        };
      });

      let delivery = {
        ok: true,
        error: null as string | null,
        channel: result.deliveryChannel as "whatsapp" | "email",
        recipientSource: result.notification.recipientSource,
        whatsappIdentitySource: result.notification.whatsappIdentitySource,
      };
      if (result.deliveryChannel === "whatsapp" && !result.notification.ok) {
        delivery = {
          ok: false,
          error: result.notification.error,
          channel: "whatsapp" as const,
          recipientSource: result.notification.recipientSource,
          whatsappIdentitySource: result.notification.whatsappIdentitySource,
        };
      } else if (result.deliveryChannel === "email" && !result.emailNotification.ok) {
        delivery = {
          ok: false,
          error: result.emailNotification.error,
          channel: "email" as const,
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

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.orderRow.id,
        eventType: "payment_details_sent",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          recipient: maskPhoneNumber(result.orderRow.customerPhone ?? null),
          deliveryChannel: delivery.channel,
          recipientSource: delivery.recipientSource,
          whatsappIdentitySource: delivery.whatsappIdentitySource,
          windowExpiresAt: result.windowState.whatsappWindowExpiresAt?.toISOString() ?? null,
        },
      });

      recordBusinessEvent({
        event: "order.payment_details_sent",
        action: "sendPaymentDetails",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: result.orderRow.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.orderRow.status,
        attributes: {
          delivery_ok: delivery.ok,
          delivery_channel: delivery.channel,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return {
        ok: delivery.ok,
        error: delivery.error,
        deliveryChannel: delivery.channel,
        orderId: result.orderRow.id,
        windowExpiresAt: result.windowState.whatsappWindowExpiresAt,
      };
    }),

  reviewPayment: businessProcedure
    .input(
      z.object({
        paymentId: z.string().min(1),
        action: reviewActionSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const [paymentRow] = await tx
          .select()
          .from(orderPayments)
          .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.id, input.paymentId)))
          .limit(1);
        if (!paymentRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order payment not found." });
        }

        await lockWorkflowKey(tx, `${ctx.businessId}::order::${paymentRow.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "reviewPayment", paymentRow.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, paymentRow.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }
        if (String(paymentRow.status || "").trim().toLowerCase() !== "submitted") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only submitted payments can be reviewed." });
        }
        if (String(orderRow.status || "").trim().toLowerCase() !== "payment_submitted") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only payment-submitted orders can be reviewed." });
        }
        assertPaymentReviewAllowed({
          orderRow,
          paymentRow,
          action: input.action,
        });
        const [latestPayment] = await tx
          .select({
            id: orderPayments.id,
            status: orderPayments.status,
          })
          .from(orderPayments)
          .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.orderId, paymentRow.orderId)))
          .orderBy(desc(orderPayments.createdAt), desc(orderPayments.id))
          .limit(1);
        if (!latestPayment || latestPayment.id !== paymentRow.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only the latest payment submission can be reviewed." });
        }

        const nextPaymentStatus = input.action === "approve" ? "approved_manual" : "rejected";
        const nextOrderStatus = input.action === "approve" ? "paid" : "payment_rejected";
        const nextFulfillmentStatus =
          input.action === "approve" && normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus) === "on_hold"
            ? "queued"
            : normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus);

        const [updatedPayment] = await tx
          .update(orderPayments)
          .set({
            status: nextPaymentStatus,
            aiCheckNotes: input.notes?.trim() || paymentRow.aiCheckNotes,
            updatedAt: now,
          })
          .where(eq(orderPayments.id, paymentRow.id))
          .returning();

        const [updatedOrder] = await tx
          .update(orders)
          .set({
            status: nextOrderStatus,
            fulfillmentStatus: nextFulfillmentStatus,
            fulfillmentUpdatedAt:
              input.action === "approve" && normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus) === "on_hold"
                ? now
                : orderRow.fulfillmentUpdatedAt,
            paidAmount: paymentRow.paidAmount ?? orderRow.paidAmount,
            paymentApprovedAt: input.action === "approve" ? now : null,
            paymentRejectedAt: input.action === "reject" ? now : null,
            updatedAt: now,
          })
          .where(eq(orders.id, orderRow.id))
          .returning();

        if (!updatedPayment || !updatedOrder) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to review payment." });
        }

        let finalizedOrder = updatedOrder;
        let invoiceArtifact: Awaited<ReturnType<typeof createOrderInvoiceArtifact>> | null = null;
        if (input.action === "approve") {
          invoiceArtifact = await createOrderInvoiceArtifact({
            businessId: ctx.businessId,
            order: {
              ...updatedOrder,
              paidAmount: updatedPayment.paidAmount ?? updatedOrder.paidAmount,
            },
            issuedAt: now,
          });
          const [invoiceUpdatedOrder] = await tx
            .update(orders)
            .set({
              invoiceNumber: invoiceArtifact.invoiceNumber,
              invoiceUrl: invoiceArtifact.url,
              invoiceStoragePath: invoiceArtifact.storagePath,
              invoiceFileName: invoiceArtifact.fileName,
              invoiceStatus: "sent",
              invoiceDeliveryMethod: null,
              invoiceGeneratedAt: invoiceArtifact.generatedAt,
              invoiceSentAt: null,
              updatedAt: now,
            })
            .where(eq(orders.id, updatedOrder.id))
            .returning();
          if (invoiceUpdatedOrder) {
            finalizedOrder = invoiceUpdatedOrder;
          }
        }

        const contactContext = await resolveOrderNotificationContext({
          businessId: ctx.businessId,
          customerId: finalizedOrder.customerId ?? null,
          threadId: finalizedOrder.threadId ?? null,
          whatsappIdentityId: finalizedOrder.whatsappIdentityId ?? null,
          customerName: finalizedOrder.customerName ?? null,
          customerEmail: finalizedOrder.customerEmail ?? null,
          customerPhone: finalizedOrder.customerPhone ?? null,
        });
        const windowState = await getThreadWhatsappWindowState(tx, finalizedOrder.threadId);
        const hasWhatsappRoute = Boolean(contactContext.whatsappIdentityId && sanitizePhoneDigits(contactContext.approvalRecipient));
        const hasEmailRoute = Boolean(contactContext.customerEmail);
        const deliveryChannel: "whatsapp" | "email" =
          windowState.whatsappWindowOpen && hasWhatsappRoute
            ? "whatsapp"
            : hasEmailRoute
              ? "email"
              : hasWhatsappRoute
                ? "whatsapp"
                : (() => {
                    throw new TRPCError({
                      code: "BAD_REQUEST",
                      message: "This order is missing both an active WhatsApp route and a customer email address.",
                    });
                  })();
        const notification = deliveryChannel === "whatsapp"
          ? await enqueueWhatsAppOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: finalizedOrder.id,
              customerId: finalizedOrder.customerId ?? null,
              threadId: contactContext.threadId ?? null,
              whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
              recipient: contactContext.approvalRecipient,
              recipientSource: contactContext.recipientSource,
              whatsappIdentitySource: contactContext.whatsappIdentitySource,
              source: input.action === "approve" ? "order_payment_approved" : "order_payment_rejected",
              idempotencyBaseKey: `order:${finalizedOrder.id}:payment_review:${paymentRow.id}:${input.action}`,
              messages: buildPaymentReviewMessages({
                action: input.action,
                orderId: finalizedOrder.id,
                paymentReference: finalizedOrder.paymentReference,
                paidAmount: updatedPayment.paidAmount ?? finalizedOrder.paidAmount,
                currency: String(finalizedOrder.currency || "LKR").trim() || "LKR",
                notes: input.notes?.trim() || null,
                invoiceUrl: refreshOrderInvoiceUrl(finalizedOrder),
              }),
            })
          : {
              ok: true as const,
              error: null,
              recipientSource: null,
              whatsappIdentitySource: null,
              idempotencyKeys: [] as string[],
            };
        const emailNotification = deliveryChannel === "email"
          ? await enqueueEmailOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: finalizedOrder.id,
              customerId: finalizedOrder.customerId ?? null,
              recipientEmail: contactContext.customerEmail,
              source: input.action === "approve" ? "order_payment_approved_email" : "order_payment_rejected_email",
              idempotencyBaseKey: `order:${finalizedOrder.id}:payment_review_email:${paymentRow.id}:${input.action}`,
              messages: [
                buildPaymentReviewEmail({
                  action: input.action,
                  orderId: finalizedOrder.id,
                  paymentReference: finalizedOrder.paymentReference,
                  paidAmount: updatedPayment.paidAmount ?? finalizedOrder.paidAmount,
                  currency: String(finalizedOrder.currency || "LKR").trim() || "LKR",
                  notes: input.notes?.trim() || null,
                  invoiceUrl: refreshOrderInvoiceUrl(finalizedOrder),
                }),
              ],
            })
          : { ok: true as const, error: null, idempotencyKeys: [] as string[] };

        return {
          paymentRow,
          orderRow,
          updatedPayment,
          updatedOrder: finalizedOrder,
          nextPaymentStatus,
          nextOrderStatus,
          nextFulfillmentStatus,
          notification,
          emailNotification,
          deliveryChannel,
          windowState,
          invoiceArtifact,
        };
      });

      let delivery: {
        ok: boolean;
        error: string | null;
        channel: "whatsapp" | "email";
        recipientSource: string | null;
        whatsappIdentitySource: string | null;
      } = {
        ok: true,
        error: null,
        channel: result.deliveryChannel,
        recipientSource: result.notification.recipientSource,
        whatsappIdentitySource: result.notification.whatsappIdentitySource,
      };
      if (result.deliveryChannel === "whatsapp" && !result.notification.ok) {
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

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: input.action === "approve" ? "payment_approved" : "payment_rejected",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          notes: input.notes?.trim() || null,
          paymentId: result.paymentRow.id,
          paymentStatus: result.nextPaymentStatus,
          fulfillmentStatus: result.nextFulfillmentStatus,
          invoiceNumber: result.updatedOrder.invoiceNumber,
        },
      });
      if (input.action === "approve" && normalizeOrderFulfillmentStatus(result.orderRow.fulfillmentStatus) === "on_hold") {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "fulfillment_released",
          actorType: "system",
          actorLabel: "system",
          payload: {
            from: result.orderRow.fulfillmentStatus,
            to: result.nextFulfillmentStatus,
          },
        });
      }
      if (!delivery.ok) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "payment_review_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            action: input.action,
            error: delivery.error,
          },
        });
      }

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: result.updatedOrder.id,
        payload: {
          order: {
            ...result.updatedOrder,
            latestPayment: result.updatedPayment,
          } as any,
        },
        createdAt: result.updatedOrder.updatedAt ?? result.updatedOrder.createdAt ?? now,
      });

      recordBusinessEvent({
        event: "order.payment_reviewed",
        action: "reviewPayment",
        area: "order",
        businessId: ctx.businessId,
        entity: "order_payment",
        entityId: result.paymentRow.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.nextPaymentStatus,
        attributes: {
          action: input.action,
          order_id: result.updatedOrder.id,
          delivery_ok: delivery.ok,
          delivery_channel: delivery.channel,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return {
        order: result.updatedOrder,
        payment: result.updatedPayment,
        delivery,
      };
    }),

  updateFulfillment: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        fulfillmentStatus: fulfillmentStatusSchema.optional(),
        recipientName: z.string().optional().nullable(),
        recipientPhone: z.string().optional().nullable(),
        shippingAddress: z.string().optional().nullable(),
        deliveryArea: z.string().optional().nullable(),
        deliveryNotes: z.string().optional().nullable(),
        courierName: z.string().optional().nullable(),
        trackingNumber: z.string().optional().nullable(),
        trackingUrl: z.string().optional().nullable(),
        dispatchReference: z.string().optional().nullable(),
        scheduledDeliveryAt: z.string().optional().nullable(),
        fulfillmentNotes: z.string().optional().nullable(),
        notifyCustomer: z.boolean().optional(),
        customerMessage: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "updateFulfillment", input.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }
        assertOrderAllowsFulfillmentUpdates(orderRow);
        assertExpectedUpdatedAt({
          entityLabel: "order",
          expectedUpdatedAt: input.expectedUpdatedAt,
          actualUpdatedAt: orderRow.updatedAt,
        });

        const nextFulfillmentStatus = input.fulfillmentStatus
          ? normalizeOrderFulfillmentStatus(input.fulfillmentStatus)
          : normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus);
        const nextRecipientName = cleanOptionalText(
          input.recipientName === undefined ? orderRow.recipientName : input.recipientName,
          160,
        );
        const nextRecipientPhone = cleanOptionalText(
          input.recipientPhone === undefined ? orderRow.recipientPhone : input.recipientPhone,
          50,
        );
        const nextShippingAddress = cleanOptionalText(
          input.shippingAddress === undefined ? orderRow.shippingAddress : input.shippingAddress,
          1200,
        );
        const nextDeliveryArea = cleanOptionalText(
          input.deliveryArea === undefined ? orderRow.deliveryArea : input.deliveryArea,
          200,
        );
        const nextDeliveryNotes = cleanOptionalText(
          input.deliveryNotes === undefined ? orderRow.deliveryNotes : input.deliveryNotes,
          1200,
        );
        const nextCourierName = cleanOptionalText(
          input.courierName === undefined ? orderRow.courierName : input.courierName,
          160,
        );
        const nextTrackingNumber = cleanOptionalText(
          input.trackingNumber === undefined ? orderRow.trackingNumber : input.trackingNumber,
          160,
        );
        const nextTrackingUrl = cleanOptionalUrl(
          input.trackingUrl === undefined ? orderRow.trackingUrl : input.trackingUrl,
        );
        const nextDispatchReference = cleanOptionalText(
          input.dispatchReference === undefined ? orderRow.dispatchReference : input.dispatchReference,
          200,
        );
        const nextScheduledDeliveryAt =
          input.scheduledDeliveryAt === undefined
            ? orderRow.scheduledDeliveryAt
            : parseOptionalDate(input.scheduledDeliveryAt);
        const nextFulfillmentNotes = cleanOptionalText(
          input.fulfillmentNotes === undefined ? orderRow.fulfillmentNotes : input.fulfillmentNotes,
          1200,
        );

        if (requiresDispatchData(nextFulfillmentStatus) && !coalesceText(nextCourierName, nextTrackingNumber, nextDispatchReference)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add courier name, tracking number, or dispatch reference before moving an order into transit.",
          });
        }
        if (requiresDispatchData(nextFulfillmentStatus) && !nextShippingAddress) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add the delivery address before dispatching the order.",
          });
        }
        if (requiresDispatchData(nextFulfillmentStatus) && !coalesceText(nextRecipientPhone, orderRow.customerPhone)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add the recipient phone before dispatching the order.",
          });
        }
        if (nextFulfillmentStatus === "delivered" && !coalesceText(nextRecipientName, orderRow.customerName)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add the recipient name before marking the order delivered.",
          });
        }

        const statusChanged =
          normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus) !== nextFulfillmentStatus;
        const nextTimestamps = nextFulfillmentTimestamps({
          currentStatus: orderRow.fulfillmentStatus,
          nextStatus: nextFulfillmentStatus,
          now,
          existing: orderRow,
        });

        const [updatedOrder] = await tx
          .update(orders)
          .set({
            fulfillmentStatus: nextFulfillmentStatus,
            fulfillmentUpdatedAt: nextTimestamps.fulfillmentUpdatedAt ?? orderRow.fulfillmentUpdatedAt,
            recipientName: nextRecipientName,
            recipientPhone: nextRecipientPhone,
            shippingAddress: nextShippingAddress,
            deliveryArea: nextDeliveryArea,
            deliveryNotes: nextDeliveryNotes,
            courierName: nextCourierName,
            trackingNumber: nextTrackingNumber,
            trackingUrl: nextTrackingUrl,
            dispatchReference: nextDispatchReference,
            scheduledDeliveryAt: nextScheduledDeliveryAt,
            fulfillmentNotes: nextFulfillmentNotes,
            packedAt: nextTimestamps.packedAt,
            dispatchedAt: nextTimestamps.dispatchedAt,
            outForDeliveryAt: nextTimestamps.outForDeliveryAt,
            deliveredAt: nextTimestamps.deliveredAt,
            failedDeliveryAt: nextTimestamps.failedDeliveryAt,
            returnedAt: nextTimestamps.returnedAt,
            updatedAt: now,
          })
          .where(and(eq(orders.id, orderRow.id), eq(orders.updatedAt, orderRow.updatedAt)))
          .returning();

        if (!updatedOrder) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This order was updated by another staff member. Refresh and try again.",
          });
        }

        const shouldNotifyCustomer = Boolean(input.notifyCustomer) && statusChanged;
        let notification: {
          ok: boolean;
          error: string | null;
          recipientSource: string | null;
          whatsappIdentitySource: string | null;
          idempotencyKeys: string[];
        } = {
          ok: true,
          error: null as string | null,
          recipientSource: null as string | null,
          whatsappIdentitySource: null as string | null,
          idempotencyKeys: [] as string[],
        };
        const emailNotification: {
          ok: boolean;
          error: string | null;
          idempotencyKeys: string[];
        } = {
          ok: true,
          error: null as string | null,
          idempotencyKeys: [] as string[],
        };
        if (shouldNotifyCustomer) {
          const contactContext = await resolveOrderNotificationContext({
            businessId: ctx.businessId,
            customerId: updatedOrder.customerId ?? null,
            threadId: updatedOrder.threadId ?? null,
            whatsappIdentityId: updatedOrder.whatsappIdentityId ?? null,
            customerName: updatedOrder.customerName ?? null,
            customerEmail: updatedOrder.customerEmail ?? null,
            customerPhone: updatedOrder.customerPhone ?? null,
          });
          if (shouldNotifyCustomer) {
            notification = await enqueueWhatsAppOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: updatedOrder.id,
              customerId: updatedOrder.customerId ?? null,
              threadId: contactContext.threadId ?? null,
              whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
              recipient: contactContext.approvalRecipient,
              recipientSource: contactContext.recipientSource,
              whatsappIdentitySource: contactContext.whatsappIdentitySource,
              source: "order_fulfillment_update",
              idempotencyBaseKey: `order:${updatedOrder.id}:fulfillment:${nextFulfillmentStatus}:${String(updatedOrder.updatedAt ?? now.toISOString())}`,
              messages: input.customerMessage?.trim()
                ? [{ type: "text", text: input.customerMessage.trim() }]
                : buildFulfillmentStatusMessages({
                    customerName: updatedOrder.customerName,
                    orderId: updatedOrder.id,
                    fulfillmentStatus: nextFulfillmentStatus,
                    courierName: nextCourierName,
                    trackingNumber: nextTrackingNumber,
                    trackingUrl: nextTrackingUrl,
                    scheduledDeliveryAt: nextScheduledDeliveryAt,
                    note: nextFulfillmentStatus === "failed_delivery" ? nextFulfillmentNotes : null,
                  }),
            });
          }
        }

        return {
          orderRow,
          updatedOrder,
          nextFulfillmentStatus,
          nextRecipientName,
          nextCourierName,
          nextTrackingNumber,
          nextDispatchReference,
          nextScheduledDeliveryAt,
          statusChanged,
          shouldNotifyCustomer,
          notification,
          emailNotification,
        };
      });

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: result.statusChanged ? "fulfillment_status_changed" : "fulfillment_details_updated",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          previousStatus: result.orderRow.fulfillmentStatus,
          nextStatus: result.nextFulfillmentStatus,
          courierName: result.nextCourierName,
          trackingNumber: result.nextTrackingNumber,
          dispatchReference: result.nextDispatchReference,
          scheduledDeliveryAt: result.nextScheduledDeliveryAt ? new Date(result.nextScheduledDeliveryAt).toISOString() : null,
        },
      });

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
      if (result.emailNotification.ok && result.emailNotification.idempotencyKeys.length) {
        await drainBusinessOutbox({
          businessId: ctx.businessId,
          idempotencyKeys: result.emailNotification.idempotencyKeys,
          limit: result.emailNotification.idempotencyKeys.length,
        });
      }
      await flushBusinessOutbox(ctx.businessId);
      if (result.shouldNotifyCustomer && !delivery.ok) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "fulfillment_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            fulfillmentStatus: result.nextFulfillmentStatus,
            error: delivery.error,
          },
        });
      }

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: result.updatedOrder.id,
        payload: { order: result.updatedOrder as any },
        createdAt: result.updatedOrder.updatedAt ?? now,
      });

      recordBusinessEvent({
        event: "order.fulfillment_updated",
        action: "updateFulfillment",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: result.updatedOrder.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.nextFulfillmentStatus,
        attributes: {
          previous_status: result.orderRow.fulfillmentStatus,
          courier_name_present: Boolean(result.nextCourierName),
          tracking_number_present: Boolean(result.nextTrackingNumber),
          notify_customer: result.shouldNotifyCustomer,
          delivery_ok: delivery.ok,
        },
      });

      return { order: result.updatedOrder, delivery };
    }),

  captureManualPayment: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        amount: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "captureManualPayment", input.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }
        if (!canCaptureManualPayment(orderRow)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only manual or cash-on-delivery orders awaiting collection can be marked as paid.",
          });
        }

        const paidAmount = resolveRefundAmount(input.amount, orderRow) ?? orderRow.expectedAmount?.toString() ?? null;
        const [updatedOrder] = await tx
          .update(orders)
          .set({
            status: "paid",
            paidAmount,
            paymentApprovedAt: now,
            updatedAt: now,
          })
          .where(eq(orders.id, orderRow.id))
          .returning();

        if (!updatedOrder) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to record manual payment." });
        }

        const invoiceArtifact = await createOrderInvoiceArtifact({
          businessId: ctx.businessId,
          order: {
            ...updatedOrder,
            paidAmount,
          },
          issuedAt: now,
        });
        const [invoiceUpdatedOrder] = await tx
          .update(orders)
          .set({
            invoiceNumber: invoiceArtifact.invoiceNumber,
            invoiceUrl: invoiceArtifact.url,
            invoiceStoragePath: invoiceArtifact.storagePath,
            invoiceFileName: invoiceArtifact.fileName,
            invoiceStatus: "sent",
            invoiceDeliveryMethod: null,
            invoiceGeneratedAt: invoiceArtifact.generatedAt,
            invoiceSentAt: null,
            updatedAt: now,
          })
          .where(eq(orders.id, updatedOrder.id))
          .returning();
        const currentOrder = invoiceUpdatedOrder ?? updatedOrder;

        const contactContext = await resolveOrderNotificationContext({
          businessId: ctx.businessId,
          customerId: currentOrder.customerId ?? null,
          threadId: currentOrder.threadId ?? null,
          whatsappIdentityId: currentOrder.whatsappIdentityId ?? null,
          customerName: currentOrder.customerName ?? null,
          customerEmail: currentOrder.customerEmail ?? null,
          customerPhone: currentOrder.customerPhone ?? null,
        });
        const windowState = await getThreadWhatsappWindowState(tx, currentOrder.threadId);
        const hasWhatsappRoute = Boolean(contactContext.whatsappIdentityId && sanitizePhoneDigits(contactContext.approvalRecipient));
        const hasEmailRoute = Boolean(contactContext.customerEmail);
        const deliveryChannel: "whatsapp" | "email" =
          windowState.whatsappWindowOpen && hasWhatsappRoute
            ? "whatsapp"
            : hasEmailRoute
              ? "email"
              : hasWhatsappRoute
                ? "whatsapp"
                : (() => {
                    throw new TRPCError({
                      code: "BAD_REQUEST",
                      message: "This order is missing both an active WhatsApp route and a customer email address.",
                    });
                  })();
        const notification = deliveryChannel === "whatsapp"
          ? await enqueueWhatsAppOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: currentOrder.id,
              customerId: currentOrder.customerId ?? null,
              threadId: contactContext.threadId ?? null,
              whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
              recipient: contactContext.approvalRecipient,
              recipientSource: contactContext.recipientSource,
              whatsappIdentitySource: contactContext.whatsappIdentitySource,
              source: "order_manual_payment_collected",
              idempotencyBaseKey: `order:${currentOrder.id}:manual_payment:${String(currentOrder.paymentApprovedAt ?? now.toISOString())}`,
              messages: buildManualCollectionMessages({
                customerName: currentOrder.customerName,
                orderId: currentOrder.id,
                currency: String(currentOrder.currency || "LKR").trim() || "LKR",
                paidAmount,
                invoiceUrl: refreshOrderInvoiceUrl(currentOrder),
              }),
            })
          : {
              ok: true as const,
              error: null,
              recipientSource: null,
              whatsappIdentitySource: null,
              idempotencyKeys: [] as string[],
            };
        const emailNotification = deliveryChannel === "email"
          ? await enqueueEmailOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: currentOrder.id,
              customerId: currentOrder.customerId ?? null,
              recipientEmail: contactContext.customerEmail,
              source: "order_manual_payment_collected_email",
              idempotencyBaseKey: `order:${currentOrder.id}:manual_payment_email:${String(currentOrder.paymentApprovedAt ?? now.toISOString())}`,
              messages: [
                buildManualCollectionEmail({
                  customerName: currentOrder.customerName,
                  orderId: currentOrder.id,
                  currency: String(currentOrder.currency || "LKR").trim() || "LKR",
                  paidAmount,
                  invoiceUrl: refreshOrderInvoiceUrl(currentOrder),
                }),
              ],
            })
          : { ok: true as const, error: null, idempotencyKeys: [] as string[] };
        return { orderRow, updatedOrder: currentOrder, paidAmount, notification, emailNotification, deliveryChannel };
      });

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: "manual_payment_collected",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          amount: result.paidAmount,
          note: cleanOptionalText(input.note, 400),
          paymentMethod: result.updatedOrder.paymentMethod,
          invoiceNumber: result.updatedOrder.invoiceNumber,
        },
      });

      let delivery: {
        ok: boolean;
        error: string | null;
        channel: "whatsapp" | "email";
        recipientSource: string | null;
        whatsappIdentitySource: string | null;
      } = {
        ok: true,
        error: null,
        channel: result.deliveryChannel,
        recipientSource: result.notification.recipientSource,
        whatsappIdentitySource: result.notification.whatsappIdentitySource,
      };
      if (result.deliveryChannel === "whatsapp" && !result.notification.ok) {
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
      if (delivery.ok) {
        await db
          .update(orders)
          .set({
            invoiceSentAt: now,
            invoiceDeliveryMethod: delivery.channel,
            updatedAt: now,
          })
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, result.updatedOrder.id)));
      }
      if (!delivery.ok) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "manual_payment_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            error: delivery.error,
          },
        });
      }

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: result.updatedOrder.id,
        payload: { order: result.updatedOrder as any },
        createdAt: result.updatedOrder.updatedAt ?? now,
      });

      recordBusinessEvent({
        event: "order.manual_payment_collected",
        action: "captureManualPayment",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: result.updatedOrder.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.updatedOrder.status,
        attributes: {
          payment_method: result.updatedOrder.paymentMethod,
          delivery_ok: delivery.ok,
          delivery_channel: delivery.channel,
        },
      });

      return { order: result.updatedOrder, delivery };
    }),

  updateRefundStatus: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        action: refundActionSchema,
        amount: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "updateRefundStatus", input.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }

        const nextRefundAmount = resolveRefundAmount(input.amount, orderRow);
        const nextRefundReason = input.reason?.trim() || orderRow.refundReason || null;

        if (input.action === "mark_pending" && orderRow.status !== "paid") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only paid orders can be moved into refund pending." });
        }
        if (input.action === "mark_refunded" && !["paid", "refund_pending"].includes(String(orderRow.status || ""))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only paid or refund-pending orders can be marked refunded." });
        }
        if (input.action === "cancel" && orderRow.status !== "refund_pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only refund-pending orders can cancel the refund flow." });
        }

        const nextStatus =
          input.action === "mark_pending"
            ? "refund_pending"
            : input.action === "mark_refunded"
              ? "refunded"
              : "paid";
        const eventType =
          input.action === "mark_pending"
            ? "refund_pending"
            : input.action === "mark_refunded"
              ? "refund_completed"
              : "refund_cancelled";

        const [updatedOrder] = await tx
          .update(orders)
          .set({
            status: nextStatus,
            refundAmount: input.action === "cancel" ? null : nextRefundAmount,
            refundReason: input.action === "cancel" ? null : nextRefundReason,
            refundRequestedAt:
              input.action === "mark_pending"
                ? now
                : input.action === "mark_refunded"
                  ? orderRow.refundRequestedAt ?? now
                  : null,
            refundedAt: input.action === "mark_refunded" ? now : null,
            updatedAt: now,
          })
          .where(eq(orders.id, orderRow.id))
          .returning();

        if (!updatedOrder) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update refund status." });
        }

        const contactContext = await resolveOrderNotificationContext({
          businessId: ctx.businessId,
          customerId: updatedOrder.customerId ?? null,
          threadId: updatedOrder.threadId ?? null,
          whatsappIdentityId: updatedOrder.whatsappIdentityId ?? null,
          customerName: updatedOrder.customerName ?? null,
          customerEmail: updatedOrder.customerEmail ?? null,
          customerPhone: updatedOrder.customerPhone ?? null,
        });
        const notification = await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: updatedOrder.id,
          customerId: updatedOrder.customerId ?? null,
          threadId: contactContext.threadId ?? null,
          whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source:
            input.action === "mark_pending"
              ? "order_refund_pending"
              : input.action === "mark_refunded"
                ? "order_refund_completed"
                : "order_refund_cancelled",
          idempotencyBaseKey: `order:${updatedOrder.id}:refund:${input.action}:${String(updatedOrder.updatedAt ?? now.toISOString())}`,
          messages: buildRefundStatusMessages({
            action: input.action,
            orderId: updatedOrder.id,
            paymentReference: updatedOrder.paymentReference,
            refundAmount: input.action === "cancel" ? null : nextRefundAmount,
            currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
            reason: input.action === "cancel" ? null : nextRefundReason,
          }),
        });
        return { orderRow, updatedOrder, nextRefundAmount, nextRefundReason, nextStatus, eventType, notification };
      });

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: result.eventType,
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          reason: input.action === "cancel" ? null : result.nextRefundReason,
          refundAmount: input.action === "cancel" ? null : result.nextRefundAmount,
          previousStatus: result.orderRow.status,
          nextStatus: result.nextStatus,
        },
      });

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: result.updatedOrder.id,
        payload: { order: result.updatedOrder as any },
        createdAt: result.updatedOrder.updatedAt ?? result.updatedOrder.createdAt ?? now,
      });

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
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "refund_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            action: input.action,
            error: delivery.error,
          },
        });
      }

      recordBusinessEvent({
        event: "order.refund_status_updated",
        action: "updateRefundStatus",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: result.updatedOrder.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.nextStatus,
        attributes: {
          previous_status: result.orderRow.status,
          refund_action: input.action,
          refund_amount: input.action === "cancel" ? null : result.nextRefundAmount,
          delivery_ok: delivery.ok,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return { order: result.updatedOrder, delivery };
    }),
});
