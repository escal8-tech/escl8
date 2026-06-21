import {
  coalesceText,
  preferredWhatsAppNumber,
} from "@/server/services/orderWorkflowSupport";
import { BotSendMessage } from "@/server/services/botApi";
import { OrderEmailMessage } from "@/server/services/orderFlow";
import { db } from "@/server/db/client";
import { and, eq } from "drizzle-orm";
import { customers, messageThreads } from "../../../drizzle/schema";

type OrderCustomerContext = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  source: string | null;
  channelIdentityId: string | null;
};

type OrderThreadContext = {
  threadId: string;
  channelIdentityId: string | null;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerExternalId: string | null;
  customerSource: string | null;
};

async function getOrderCustomerContext(businessId: string, customerId: string | null | undefined): Promise<OrderCustomerContext | null> {
  const normalizedCustomerId = String(customerId ?? "").trim();
  if (!normalizedCustomerId) return null;
  const [row] = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      externalId: customers.externalId,
      source: customers.source,
      channelIdentityId: customers.channelIdentityId,
    })
    .from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.id, normalizedCustomerId)))
    .limit(1);
  return row ?? null;
}

async function getOrderThreadContext(businessId: string, threadId: string | null | undefined): Promise<OrderThreadContext | null> {
  const normalizedThreadId = String(threadId ?? "").trim();
  if (!normalizedThreadId) return null;
  const [row] = await db
    .select({
      threadId: messageThreads.id,
      channelIdentityId: messageThreads.channelIdentityId,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerExternalId: customers.externalId,
      customerSource: customers.source,
    })
    .from(messageThreads)
    .innerJoin(customers, eq(messageThreads.customerId, customers.id))
    .where(and(eq(messageThreads.businessId, businessId), eq(messageThreads.id, normalizedThreadId)))
    .limit(1);
  return row ?? null;
}

export async function resolveOrderNotificationContext(params: {
  businessId: string;
  customerId?: string | null;
  threadId?: string | null;
  channelIdentityId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}) {
  const directCustomer = await getOrderCustomerContext(params.businessId, params.customerId);
  const threadContext = await getOrderThreadContext(params.businessId, params.threadId);

  const customerName = coalesceText(
    params.customerName,
    directCustomer?.name ?? null,
    threadContext?.customerName ?? null,
  );
  const customerEmail = coalesceText(
    params.customerEmail,
    directCustomer?.email ?? null,
  );
  const customerPhone = coalesceText(
    params.customerPhone,
    directCustomer?.phone ?? null,
    threadContext?.customerPhone ?? null,
    (directCustomer?.source ?? "").toLowerCase() === "whatsapp" ? directCustomer?.externalId ?? null : null,
  );
  const channelIdentityId = coalesceText(
    params.channelIdentityId,
    directCustomer?.channelIdentityId ?? null,
    threadContext?.channelIdentityId ?? null,
  );
  const recipient =
    preferredWhatsAppNumber("whatsapp", customerPhone) ??
    preferredWhatsAppNumber(directCustomer?.source, directCustomer?.phone, directCustomer?.externalId) ??
    preferredWhatsAppNumber(threadContext?.customerSource, threadContext?.customerPhone, threadContext?.customerExternalId);

  return {
    customerName,
    customerEmail,
    threadId: coalesceText(params.threadId, threadContext?.threadId ?? null),
    channelIdentityId,
    approvalRecipient: recipient ?? "",
    recipientSource:
      preferredWhatsAppNumber("whatsapp", customerPhone) != null
        ? "order.customer_phone"
        : preferredWhatsAppNumber(directCustomer?.source, directCustomer?.phone) != null
          ? "customer.phone"
          : preferredWhatsAppNumber(directCustomer?.source, directCustomer?.externalId) != null
            ? "customer.external_id"
            : preferredWhatsAppNumber(threadContext?.customerSource, threadContext?.customerPhone) != null
              ? "thread.customer.phone"
              : preferredWhatsAppNumber(threadContext?.customerSource, threadContext?.customerExternalId) != null
                ? "thread.customer.external_id"
                : null,
    whatsappIdentitySource: coalesceText(params.channelIdentityId)
      ? "order.channel_identity_id"
      : coalesceText(directCustomer?.channelIdentityId ?? null)
        ? "customer.channel_identity_id"
        : coalesceText(threadContext?.channelIdentityId ?? null)
          ? "thread.channel_identity_id"
          : null,
  };
}

export function buildPaymentReviewMessages(input: {
  action: "approve" | "reject";
  orderId: string;
  paymentReference?: string | null;
  paidAmount?: string | number | null;
  currency: string;
  notes?: string | null;
}): BotSendMessage[] {
  const ref = String(input.paymentReference || input.orderId.slice(0, 8).toUpperCase()).trim();
  if (input.action === "approve") {
    return [];
  }
  const lines = [
    `We could not confirm the payment for order number ${ref}, so this order has now been closed.`,
    input.notes ? `Reason: ${String(input.notes).trim()}.` : null,
    "If you still want this item, please message us again and we can start a fresh order.",
  ].filter(Boolean);
  return [{ type: "text", text: lines.join("\n") }];
}

export function buildPaymentReviewEmail(input: {
  action: "reject";
  orderId: string;
  paymentReference?: string | null;
  paidAmount?: string | number | null;
  currency: string;
  notes?: string | null;
}): OrderEmailMessage {
  const ref = String(input.paymentReference || input.orderId.slice(0, 8).toUpperCase()).trim();
  const subject = `Payment needs attention: ${ref}`;
  const lines = [
    `We could not confirm the payment for order number ${ref}, so this order has now been closed.`,
    input.notes ? `Reason: ${String(input.notes).trim()}.` : null,
    "If you still want this item, reply again and we can start a fresh order.",
  ];
  const text = lines.filter(Boolean).join("\n");
  return {
    subject,
    text,
    html: `<div style="font-family:Montserrat,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#0b1220;color:#e5edf6"><div style="border:1px solid #21324a;border-radius:18px;padding:24px;background:#122038"><div style="font-size:24px;font-weight:700;margin:0 0 12px">${subject}</div><pre style="margin:0;white-space:pre-wrap;font:14px/1.7 inherit;color:#f6fbff">${text}</pre></div></div>`,
  };
}

export function buildRefundStatusMessages(input: {
  action: "mark_pending" | "mark_refunded" | "cancel";
  orderId: string;
  paymentReference?: string | null;
  refundAmount?: string | null;
  currency: string;
  reason?: string | null;
}): BotSendMessage[] {
  const ref = String(input.paymentReference || input.orderId.slice(0, 8).toUpperCase()).trim();
  if (input.action === "mark_pending") {
    const lines = [
      `We have started reviewing your refund for order number ${ref}.`,
      input.reason ? `Reason noted: ${input.reason}.` : null,
      "We will update you again as soon as the refund is processed.",
    ].filter(Boolean);
    return [{ type: "text", text: lines.join("\n") }];
  }
  if (input.action === "mark_refunded") {
    const lines = [
      `Your refund for order number ${ref} has been completed.`,
      input.refundAmount ? `Refunded amount: ${input.currency} ${input.refundAmount}.` : null,
    ].filter(Boolean);
    return [{ type: "text", text: lines.join("\n") }];
  }
  return [{ type: "text", text: `Your refund request for order number ${ref} has been cancelled, and the order remains paid.` }];
}
