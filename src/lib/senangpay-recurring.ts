import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type SenangPayRecurringStatus = "1" | "0" | "3"; // 1=success, 0=failed, 3=pending
export type SenangPayRecurringType = "subscription" | "installment";
export type SenangPayRecurringAction = "new_schedule" | "remove_schedule" | "terminate";

export interface SenangPayRecurringCheckoutPayload {
  orderId: string;
  recurringId: string;
  name: string;
  email: string;
  phone: string;
}

// Advance callback payload (JSON format from SenangPay)
export interface SenangPayRecurringCallbackPayload {
  recurringId: string;        // recurring_id
  statusId: SenangPayRecurringStatus; // status_id: 1=success, 0=failed
  orderId: string;            // order_id
  transactionId: string;      // transaction_id
  msg: string;                // msg
  nextPaymentTimestamp?: string; // next_payment_date (Unix timestamp)
  paymentDetails?: unknown;   // payment_details (JSON)
  hash: string;               // hash for verification
  raw: Record<string, string>;
}

// Standard callback payload (form-encoded)
export interface SenangPayRecurringStandardCallbackPayload {
  action: SenangPayRecurringAction;
  recurringId: string;
  type: SenangPayRecurringType;
  customerEmail: string;
  newPaymentTimestamp?: string;
  statusId?: SenangPayRecurringStatus;
  hash: string;
  raw: Record<string, string>;
}

function requireEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required for SenangPay Recurring API.`);
  return value;
}

function configuredBaseUrl() {
  const raw = String(process.env.SENANGPAY_RECURRING_BASE_URL ?? "").trim();
  if (raw) return raw.replace(/\/$/, "");
  const sandbox = String(process.env.SENANGPAY_SANDBOX ?? "").trim().toLowerCase();
  return sandbox === "1" || sandbox === "true"
    ? "https://api.sandbox.senangpay.my/recurring/payment"
    : "https://api.senangpay.my/recurring/payment";
}

export function senangPayMerchantId() {
  return requireEnv("SENANGPAY_MERCHANT_ID");
}

export function senangPaySecretKey() {
  return requireEnv("SENANGPAY_SECRET_KEY");
}

function senangPayHash(value: string) {
  const secretKey = senangPaySecretKey();
  return createHmac("sha256", secretKey).update(value).digest("hex");
}

// ============================================================
// CHECKOUT HASH (matches official docs Section I)
// Hash = sha256(secret_key + recurring_id + order_id)
// ============================================================
export function senangPayRecurringCheckoutUrl(payload: SenangPayRecurringCheckoutPayload) {
  const params = new URLSearchParams({
    order_id: payload.orderId,
    recurring_id: payload.recurringId,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    hash: senangPayRecurringCheckoutHash(payload),
  });
  return `${configuredBaseUrl()}/${encodeURIComponent(senangPayMerchantId())}?${params.toString()}`;
}

export function senangPayRecurringCheckoutHash(payload: Pick<SenangPayRecurringCheckoutPayload, "orderId" | "recurringId">) {
  // Official docs Section I: hash = sha256(secret_key + recurring_id + order_id)
  return senangPayHash(`${senangPaySecretKey()}${payload.recurringId}${payload.orderId}`);
}

// ============================================================
// ADVANCE CALLBACK HASH VERIFICATION (matches official docs Section J)
// Hash = sha256(secret_key + status_id + order_id + transaction_id + msg)
// ============================================================
export function senangPayRecurringAdvanceCallbackHash(payload: Pick<SenangPayRecurringCallbackPayload, "statusId" | "orderId" | "transactionId" | "msg">) {
  // Official docs Section J: hash = sha256(secret_key + status_id + order_id + transaction_id + msg)
  return senangPayHash(`${senangPaySecretKey()}${payload.statusId}${payload.orderId}${payload.transactionId}${payload.msg}`);
}

export function verifySenangPayRecurringAdvanceCallback(payload: SenangPayRecurringCallbackPayload) {
  const expected = senangPayRecurringAdvanceCallbackHash(payload);
  const received = String(payload.hash || "").trim().toLowerCase();
  if (!received || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

// ============================================================
// STANDARD CALLBACK HASH VERIFICATION (for non-advance callbacks)
// Based on observed format: action + recurring_id + type + customer_email
// ============================================================
export function senangPayRecurringStandardCallbackHash(payload: Pick<SenangPayRecurringStandardCallbackPayload, "action" | "recurringId" | "type" | "customerEmail">) {
  return senangPayHash(`${senangPaySecretKey()}${payload.action}${payload.recurringId}${payload.type}${payload.customerEmail}`);
}

export function verifySenangPayRecurringStandardCallback(payload: SenangPayRecurringStandardCallbackPayload) {
  const expected = senangPayRecurringStandardCallbackHash(payload);
  const received = String(payload.hash || "").trim().toLowerCase();
  if (!received || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

// ============================================================
// PARSERS
// ============================================================

export function parseSenangPayRecurringAdvanceCallback(body: unknown): SenangPayRecurringCallbackPayload {
  const parsed = body as Record<string, unknown>;
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    raw[key] = String(value ?? "");
  }

  return {
    recurringId: String(parsed.recurring_id ?? "").trim(),
    statusId: String(parsed.status_id ?? "") as SenangPayRecurringStatus,
    orderId: String(parsed.order_id ?? "").trim(),
    transactionId: String(parsed.transaction_id ?? "").trim(),
    msg: String(parsed.msg ?? "").trim(),
    nextPaymentTimestamp: String(parsed.next_payment_timestamp ?? parsed.next_payment_date ?? "").trim(),
    paymentDetails: parsed.payment_details,
    hash: String(parsed.hash ?? "").trim(),
    raw,
  };
}

export function parseSenangPayRecurringStandardParams(searchParams: URLSearchParams): SenangPayRecurringStandardCallbackPayload {
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });

  return {
    action: String(searchParams.get("action") ?? "").trim() as SenangPayRecurringAction,
    recurringId: String(searchParams.get("recurring_id") ?? "").trim(),
    type: String(searchParams.get("type") ?? "").trim() as SenangPayRecurringType,
    customerEmail: String(searchParams.get("customer_email") ?? "").trim(),
    newPaymentTimestamp: String(searchParams.get("new_payment_timestamp") ?? "").trim(),
    statusId: String(searchParams.get("status_id") ?? "") as SenangPayRecurringStatus | undefined,
    hash: String(searchParams.get("hash") ?? searchParams.get("hashed_value") ?? "").trim(),
    raw,
  };
}

export async function parseSenangPayRecurringRequest(req: Request): Promise<SenangPayRecurringCallbackPayload | SenangPayRecurringStandardCallbackPayload> {
  const url = new URL(req.url);
  if (req.method !== "POST") return parseSenangPayRecurringStandardParams(url.searchParams);

  const body = await req.text();
  const contentType = req.headers.get("content-type") ?? "";
  
  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
    // Check if it's advance callback format (has recurring_id, status_id, order_id, transaction_id, msg)
    if (parsed.recurring_id && parsed.status_id && parsed.order_id && parsed.transaction_id && parsed.msg) {
      return parseSenangPayRecurringAdvanceCallback(parsed);
    }
    // Fallback to standard format
    const params = new URLSearchParams();
    Object.entries(parsed).forEach(([key, value]) => {
      if (value !== null && value !== undefined) params.set(key, String(value));
    });
    return parseSenangPayRecurringStandardParams(params);
  }

  // Form-encoded - try standard format first
  const params = new URLSearchParams(body);
  // Check if it has advance callback fields
  if (params.has("recurring_id") && params.has("status_id") && params.has("order_id") && params.has("transaction_id") && params.has("msg")) {
    // Convert to object and parse as advance
    const obj: Record<string, unknown> = {};
    params.forEach((value, key) => { obj[key] = value; });
    return parseSenangPayRecurringAdvanceCallback(obj);
  }
  return parseSenangPayRecurringStandardParams(params);
}

export function amountForSenangPay(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("SenangPay amount must be greater than zero.");
  }
  return amount.toFixed(2);
}