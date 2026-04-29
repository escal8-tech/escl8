import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import {
  buildOrderApprovalMessages,
  buildOrderDeliveryDetailsRequestMessages,
  buildManualCollectionEmail,
  buildManualCollectionMessages,
  extractOrderFulfillmentSeed,
} from "@/server/services/orderFlow";
import { canResendPaymentDetails } from "@/server/services/orderWorkflowSupport";

test("post-approval payment messages keep the expected approval and bank detail format", () => {
  const settings = normalizeOrderFlowSettings({
    orderFlow: {
      paymentMethod: "bank_qr",
      paymentSlipRequired: true,
      currency: "LKR",
      bankQr: {
        showQr: false,
        showBankDetails: true,
        bankName: "Commercial Bank",
        accountName: "TRANSASIA",
        accountNumber: "123456789",
      },
    },
  });

  const messages = buildOrderApprovalMessages({
    orderId: "d1471747-aaaa-bbbb-cccc-1234567890ab",
    customerName: "Namith",
    itemsSummary: "RB 850 (qty 1 x 1060.00)",
    expectedAmount: "1060.00",
    paymentReference: "ORD-D1471747",
    orderSettings: settings,
  });

  assert.equal(messages[0]?.type, "text");
  assert.match(String(messages[0]?.text || ""), /Your order has been approved\./i);
  assert.match(String(messages[0]?.text || ""), /Order number: D1471747/i);
  assert.match(String(messages[0]?.text || ""), /Total due: LKR 1060.00/i);
  assert.match(String(messages[0]?.text || ""), /Payment reference: ORD-D1471747/i);
  assert.equal(messages[1]?.type, "text");
  assert.match(String(messages[1]?.text || ""), /Please complete the payment and send the payment slip image or PDF in this chat\./i);
  assert.match(String(messages[1]?.text || ""), /Bank: Commercial Bank/i);
  assert.match(String(messages[1]?.text || ""), /Account name: TRANSASIA/i);
  assert.match(String(messages[1]?.text || ""), /Account number: 123456789/i);
});

test("manual payment collection messages no longer attach invoice documents", () => {
  const messages = buildManualCollectionMessages({
    customerName: "Namith",
    orderId: "d1471747-aaaa-bbbb-cccc-1234567890ab",
    currency: "LKR",
    paidAmount: "1060.00",
  });

  assert.deepEqual(
    messages.map((message) => message.type),
    ["text"],
  );

  const email = buildManualCollectionEmail({
    customerName: "Namith",
    orderId: "d1471747-aaaa-bbbb-cccc-1234567890ab",
    currency: "LKR",
    paidAmount: "1060.00",
  });
  assert.doesNotMatch(email.text, /Invoice link/i);
});

test("post-approval delivery collection message asks only for the missing fields", () => {
  const messages = buildOrderDeliveryDetailsRequestMessages({
    orderId: "d1471747-aaaa-bbbb-cccc-1234567890ab",
    itemsSummary: "RB 850 (qty 1 x 1060.00)",
    expectedAmount: "1060.00",
    currency: "LKR",
    missingFields: ["recipient_name", "shipping_address"],
  });

  assert.equal(messages[0]?.type, "text");
  assert.match(String(messages[0]?.text || ""), /Your order has been approved\./i);
  assert.match(String(messages[0]?.text || ""), /Order number: D1471747/i);
  assert.match(String(messages[0]?.text || ""), /Total due: LKR 1060.00/i);
  assert.equal(messages[1]?.type, "text");
  assert.match(String(messages[1]?.text || ""), /1\. Full name/i);
  assert.match(String(messages[1]?.text || ""), /2\. Full delivery address/i);
  assert.doesNotMatch(String(messages[1]?.text || ""), /Phone number/i);
});

test("post-approval fulfillment seed can ignore fallback customer contact data during WhatsApp collection", () => {
  const seed = extractOrderFulfillmentSeed({
    fields: {},
    customerName: "Existing Customer",
    customerPhone: "94770000000",
    useContactFallback: false,
  });

  assert.equal(seed.recipientName, null);
  assert.equal(seed.recipientPhone, null);
  assert.equal(seed.shippingAddress, null);
});

test("post-approval fulfillment seed reuses the delivery address as the delivery area fallback", () => {
  const seed = extractOrderFulfillmentSeed({
    fields: {
      deliveryAddress: "221B Baker Street, Colombo 03",
    },
    useContactFallback: false,
  });

  assert.equal(seed.shippingAddress, "221B Baker Street, Colombo 03");
  assert.equal(seed.deliveryArea, "221B Baker Street, Colombo 03");
});

test("post-approval payment resend stays blocked until delivery details exist", () => {
  assert.equal(
    canResendPaymentDetails({
      paymentMethod: "bank_qr",
      status: "approved",
      recipientName: "Namith",
      recipientPhone: "94770000000",
      shippingAddress: "123 Main Street, Kandy",
    }),
    true,
  );
  assert.equal(
    canResendPaymentDetails({
      paymentMethod: "bank_qr",
      status: "approved",
      recipientName: "Namith",
      recipientPhone: "94770000000",
      shippingAddress: "",
    }),
    false,
  );
});
