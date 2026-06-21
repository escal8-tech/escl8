/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { customers, orders, supportTickets } from "../../../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import {
  logOrderEvent,
  parseMoneyValue,
} from "../services/orderFlow";
import {
  assertPaymentSetupEditable,
  asRecord,
  cleanOptionalText,
} from "@/server/services/orderWorkflowSupport";
import {
  extractCustomerEmail,
  logTicketEvent,
  publishHydratedTicketUpsert,
  sanitizeTicketFields,
} from "@/server/services/ticketWorkflowSupport";

export async function updateDraftOrder(
  ctx: any,
  input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    title?: string | null;
    summary?: string | null;
    notes?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
    fields?: Record<string, unknown>;
  }
) {
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
    assertPaymentSetupEditable(orderRow);
  }
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
      .where(eq(orders.id, orderRow.id))
      .returning();

    if (!updatedOrder) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update draft order.",
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
}

export async function updatePaymentSetup(
  ctx: any,
  input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    expectedAmount?: string | null;
    paymentReference?: string | null;
    customerEmail?: string | null;
    notes?: string | null;
  }
) {
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
    .where(eq(orders.id, orderRow.id))
    .returning();

  if (!updatedOrder) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update order.",
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
}
