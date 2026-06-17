import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderInvoiceEmailMessage, buildOrderInvoiceDocumentMessage } from "./orderInvoice";

test("buildOrderInvoiceEmailMessage generates correct email content", () => {
  const artifact = {
    invoiceNumber: "INV-20260617-ORDER123",
    fileName: "INV-20260617-ORDER123.pdf",
    url: "https://example.com/invoice.pdf",
    storagePath: "path/to/invoice.pdf",
    generatedAt: new Date(),
  };

  const message = buildOrderInvoiceEmailMessage({
    artifact,
    orderId: "order_123456789",
    customerName: "John Doe",
    trackingUrl: "https://example.com/track",
  });

  assert.equal(message.subject, "Invoice INV-20260617-ORDER123");
  assert.match(message.text, /Hi John Doe,/);
  assert.match(message.text, /order ORDER_12/);
  assert.match(message.html, /<a href="https:\/\/example\.com\/invoice\.pdf"/);
  assert.match(message.html, /Track your order/);
});

test("buildOrderInvoiceDocumentMessage generates correct document payload", () => {
  const artifact = {
    invoiceNumber: "INV-20260617-ORDER123",
    fileName: "INV-20260617-ORDER123.pdf",
    url: "https://example.com/invoice.pdf",
    storagePath: "path/to/invoice.pdf",
    generatedAt: new Date(),
  };

  const message = buildOrderInvoiceDocumentMessage({ artifact });

  assert.equal(message.type, "document");
  assert.equal(message.document.link, "https://example.com/invoice.pdf");
  assert.equal(message.document.filename, "INV-20260617-ORDER123.pdf");
});
