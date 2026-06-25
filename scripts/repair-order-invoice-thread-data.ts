import "dotenv/config";

import { and, desc, eq, ilike, or } from "drizzle-orm";

import { orders, threadMessages } from "../drizzle/schema";
import { db } from "@/server/db/client";
import { createOrderInvoiceForOrder } from "@/server/services/orderInvoice";

type OrderRow = typeof orders.$inferSelect;
type ThreadMessageRow = typeof threadMessages.$inferSelect;

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const apply = args.includes("--apply");
  const orderIds = args.filter((value) => value !== "--apply").map((value) => String(value).trim()).filter(Boolean);
  return { apply, orderIds };
}

function shortOrderId(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}

function pickAnchorTimestamp(order: OrderRow, originalInvoiceStatus: string | null): Date {
  const failedOriginally = String(originalInvoiceStatus || "").trim().toLowerCase() === "failed";
  if (order.invoiceSentAt) return order.invoiceSentAt;
  if (!failedOriginally && order.invoiceGeneratedAt) return order.invoiceGeneratedAt;
  if (order.paymentApprovedAt) return order.paymentApprovedAt;
  return order.createdAt ?? new Date();
}

async function loadOrder(orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return order ?? null;
}

async function loadInvoiceMessage(orderId: string) {
  const [message] = await db
    .select()
    .from(threadMessages)
    .where(
      and(
        eq(threadMessages.linkedOrderId, orderId),
        eq(threadMessages.messageKind, "order2_invoice"),
      ),
    )
    .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
    .limit(1);
  return message ?? null;
}

async function loadTrackingMessages(order: OrderRow) {
  if (!order.threadId) return [];
  const orderRef = shortOrderId(order.id);
  return db
    .select()
    .from(threadMessages)
    .where(
      and(
        eq(threadMessages.threadId, order.threadId),
        eq(threadMessages.direction, "outbound"),
        ilike(threadMessages.textBody, `%${orderRef}%`),
        or(
          ilike(threadMessages.textBody, "Track your order here:%"),
          ilike(threadMessages.textBody, "%track/orders/%"),
        ),
      ),
    )
    .orderBy(threadMessages.createdAt, threadMessages.id);
}

async function ensureInvoiceArtifact(order: OrderRow) {
  return createOrderInvoiceForOrder({
    businessId: order.businessId,
    orderId: order.id,
    deliveryMethod: "whatsapp",
    trackingUrl: null,
    forceRegenerate: String(order.invoiceStatus || "").trim().toLowerCase() === "failed",
  });
}

async function backfillInvoiceMessage(input: {
  order: OrderRow;
  artifact: NonNullable<Awaited<ReturnType<typeof createOrderInvoiceForOrder>>>;
  originalInvoiceStatus: string | null;
  createdAt: Date;
}) {
  const [inserted] = await db
    .insert(threadMessages)
    .values({
      threadId: input.order.threadId!,
      externalMessageId: null,
      direction: "outbound",
      messageType: "document",
      textBody: "[document]",
      linkedOrderId: input.order.id,
      messageKind: "order2_invoice",
      replyId: null,
      replyTitle: null,
      meta: {
        source: "order_invoice_backfill",
        backfilled: true,
        backfilledAt: new Date().toISOString(),
        backfillReason: "repair_missing_order_invoice_thread_message",
        filename: input.artifact.fileName,
        documentUrl: input.artifact.url,
        sourceMeta: {
          kind: "order2_invoice",
          orderId: input.order.id,
          businessId: input.order.businessId,
          invoiceNumber: input.artifact.invoiceNumber,
        },
        originalInvoiceStatus: input.originalInvoiceStatus,
      },
      createdAt: input.createdAt,
    })
    .returning();
  return inserted ?? null;
}

async function linkTrackingMessages(order: OrderRow, apply: boolean) {
  const trackingMessages = await loadTrackingMessages(order);
  const unlinked = trackingMessages.filter((message) => !message.linkedOrderId || !message.messageKind);
  if (!apply || !unlinked.length) {
    return { trackingMessages, linkedCount: 0 };
  }

  for (const message of unlinked) {
    await db
      .update(threadMessages)
      .set({
        linkedOrderId: order.id,
        messageKind: message.messageKind || "order2_tracking_link",
      })
      .where(eq(threadMessages.id, message.id));
  }

  return { trackingMessages, linkedCount: unlinked.length };
}

async function repairOrder(orderId: string, apply: boolean) {
  const order = await loadOrder(orderId);
  if (!order) {
    return { orderId, ok: false as const, error: "Order not found." };
  }
  if (!order.threadId) {
    return { orderId, ok: false as const, error: "Order has no thread." };
  }

  const originalInvoiceStatus = order.invoiceStatus ?? null;
  const beforeInvoiceMessage = await loadInvoiceMessage(order.id);
  const { linkedCount } = await linkTrackingMessages(order, apply);

  let artifact: NonNullable<Awaited<ReturnType<typeof createOrderInvoiceForOrder>>> | null = null;
  if (apply && (!beforeInvoiceMessage || !order.invoiceUrl || String(order.invoiceStatus || "").trim().toLowerCase() === "failed")) {
    artifact = await ensureInvoiceArtifact(order);
  } else if (!apply) {
    artifact = order.invoiceUrl && order.invoiceFileName && order.invoiceStoragePath
      ? {
          invoiceNumber: String(order.invoiceNumber || ""),
          fileName: String(order.invoiceFileName || ""),
          url: String(order.invoiceUrl || ""),
          storagePath: String(order.invoiceStoragePath || ""),
          generatedAt: order.invoiceGeneratedAt ?? new Date(),
        }
      : null;
  }

  const refreshedOrder = apply ? await loadOrder(order.id) : order;
  if (!refreshedOrder) {
    return { orderId, ok: false as const, error: "Order disappeared during repair." };
  }

  const invoiceMessage = beforeInvoiceMessage ?? (apply ? await loadInvoiceMessage(order.id) : null);
  let anchorMessageId = invoiceMessage?.id ?? refreshedOrder.threadAnchorMessageId ?? null;
  let createdMessageId: string | null = null;

  const effectiveArtifact = artifact ?? (
    refreshedOrder.invoiceUrl && refreshedOrder.invoiceFileName && refreshedOrder.invoiceStoragePath
      ? {
          invoiceNumber: String(refreshedOrder.invoiceNumber || ""),
          fileName: String(refreshedOrder.invoiceFileName || ""),
          url: String(refreshedOrder.invoiceUrl || ""),
          storagePath: String(refreshedOrder.invoiceStoragePath || ""),
          generatedAt: refreshedOrder.invoiceGeneratedAt ?? new Date(),
        }
      : null
  );

  if (!invoiceMessage && effectiveArtifact) {
    if (apply) {
      const createdAt = pickAnchorTimestamp(refreshedOrder, originalInvoiceStatus);
      const created = await backfillInvoiceMessage({
        order: refreshedOrder,
        artifact: effectiveArtifact,
        originalInvoiceStatus,
        createdAt,
      });
      createdMessageId = created?.id ?? null;
      anchorMessageId = created?.id ?? anchorMessageId;
    }
  }

  if (apply && anchorMessageId && refreshedOrder.threadAnchorMessageId !== anchorMessageId) {
    await db
      .update(orders)
      .set({
        threadAnchorMessageId: anchorMessageId,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, refreshedOrder.id));
  }

  const afterOrder = apply ? await loadOrder(order.id) : refreshedOrder;
  const afterInvoiceMessage = apply ? await loadInvoiceMessage(order.id) : invoiceMessage;

  return {
    orderId,
    ok: true as const,
    originalInvoiceStatus,
    finalInvoiceStatus: afterOrder?.invoiceStatus ?? refreshedOrder.invoiceStatus,
    invoiceNumber: afterOrder?.invoiceNumber ?? refreshedOrder.invoiceNumber,
    invoiceUrlPresent: Boolean(afterOrder?.invoiceUrl ?? refreshedOrder.invoiceUrl),
    anchorMessageId: afterOrder?.threadAnchorMessageId ?? anchorMessageId,
    invoiceMessageId: afterInvoiceMessage?.id ?? createdMessageId,
    createdMessageId,
    linkedTrackingMessages: linkedCount,
    dryRun: !apply,
  };
}

async function main() {
  const { apply, orderIds } = parseArgs(process.argv);
  if (!orderIds.length) {
    throw new Error("Usage: tsx scripts/repair-order-invoice-thread-data.ts [--apply] <order-id> [...]");
  }

  const results = [];
  for (const orderId of orderIds) {
    results.push(await repairOrder(orderId, apply));
  }

  console.log(JSON.stringify({ apply, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
