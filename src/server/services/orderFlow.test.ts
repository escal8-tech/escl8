import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import { buildOrderApprovalMessages, buildFulfillmentStatusMessages } from "@/server/services/orderFlow";

test("normalizeOrderFlowSettings defaults payment slip requirement to true", () => {
  const settings = normalizeOrderFlowSettings({});
  assert.equal(settings.paymentSlipRequired, true);
});

test("normalizeOrderFlowSettings keeps delivery charge settings", () => {
  const fixed = normalizeOrderFlowSettings({
    orderFlow: {
      deliveryCharge: { enabled: true, type: "fixed", value: "450" },
    },
  });
  const percentage = normalizeOrderFlowSettings({
    orderFlow: {
      deliveryCharge: { enabled: true, type: "percentage", value: "5.5" },
    },
  });

  assert.deepEqual(fixed.deliveryCharge, { enabled: true, type: "fixed", value: "450" });
  assert.deepEqual(percentage.deliveryCharge, { enabled: true, type: "percentage", value: "5.5" });
});

test("normalizeOrderFlowSettings defaults delivery charge to disabled free delivery", () => {
  const settings = normalizeOrderFlowSettings({
    orderFlow: {
      deliveryCharge: { type: "fixed", value: "450" },
    },
  });

  assert.deepEqual(settings.deliveryCharge, { enabled: false, type: "fixed", value: "450" });
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

test("buildFulfillmentStatusMessages keeps all fulfillment updates silent", () => {
  const messages = buildFulfillmentStatusMessages({
    customerName: "Namith",
    orderId: "12345678-aaaa-bbbb-cccc-1234567890ab",
    fulfillmentStatus: "out_for_delivery",
    courierName: "Courier",
    trackingNumber: "TRACK123",
  });

  assert.deepEqual(messages, []);
});
