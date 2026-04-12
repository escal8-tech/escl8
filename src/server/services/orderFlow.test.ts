import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import { buildOrderApprovalMessages, buildFulfillmentStatusMessages } from "@/server/services/orderFlow";

test("normalizeOrderFlowSettings defaults payment slip requirement to true", () => {
  const settings = normalizeOrderFlowSettings({});
  assert.equal(settings.paymentSlipRequired, true);
});

test("buildOrderApprovalMessages uses optional slip wording when payment slip is not required", () => {
  const settings = normalizeOrderFlowSettings({
    orderFlow: {
      paymentMethod: "bank_qr",
      paymentSlipRequired: false,
      currency: "LKR",
      bankQr: {
        showQr: false,
        showBankDetails: true,
        bankName: "Commercial Bank",
        accountName: "Transasia",
        accountNumber: "123456789",
      },
    },
  });

  const messages = buildOrderApprovalMessages({
    orderId: "12345678-aaaa-bbbb-cccc-1234567890ab",
    customerName: "Namith",
    itemsSummary: "Samsung S25 Ultra x1",
    expectedAmount: "41975.00",
    paymentReference: "315023FE",
    orderSettings: settings,
  });

  assert.equal(messages[1]?.type, "text");
  assert.match(String(messages[1]?.text || ""), /reply in this chat once the transfer is done/i);
  assert.match(String(messages[1]?.text || ""), /also send the payment slip image or pdf/i);
});

test("buildFulfillmentStatusMessages skips customer notification for delivered updates", () => {
  const messages = buildFulfillmentStatusMessages({
    customerName: "Namith",
    orderId: "12345678-aaaa-bbbb-cccc-1234567890ab",
    fulfillmentStatus: "delivered",
  });

  assert.deepEqual(messages, []);
});
