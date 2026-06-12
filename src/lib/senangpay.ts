import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type SenangPayStatus = "2" | "1" | "0";
export type SenangPayHashType = "md5" | "sha256";

export interface SenangPayCheckoutPayload {
  detail: string;
  amount: string;
  orderId: string;
  name: string;
  email: string;
  phone: string;
}

export interface SenangPayCallbackPayload {
  statusId: string;
  orderId: string;
  transactionId: string;
  message: string;
  hash: string;
  raw: Record<string, string>;
}

function requireEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required for SenangPay billing.`);
  return value;
}

function configuredBaseUrl() {
  const raw = String(process.env.SENANGPAY_PAYMENT_BASE_URL ?? "").trim();
  if (raw) return raw.replace(/\/$/, "");
  const sandbox = String(process.env.SENANGPAY_SANDBOX ?? "").trim().toLowerCase();
  return sandbox === "1" || sandbox === "true"
    ? "https://sandbox.senangpay.my/payment"
    : "https://app.senangpay.my/payment";
}

function configuredHashType(): SenangPayHashType {
  const raw = String(process.env.SENANGPAY_HASH_TYPE ?? "sha256").trim().toLowerCase();
  return raw === "md5" ? "md5" : "sha256";
}

export function senangPayMerchantId() {
  return requireEnv("SENANGPAY_MERCHANT_ID");
}

export function senangPaySecretKey() {
  return requireEnv("SENANGPAY_SECRET_KEY");
}

function senangPayHash(value: string, hashType: SenangPayHashType = configuredHashType()) {
  const secretKey = senangPaySecretKey();
  if (hashType === "md5") {
    return createHash("md5").update(value).digest("hex");
  }
  return createHmac("sha256", secretKey).update(value).digest("hex");
}

export function senangPayCheckoutUrl(payload: SenangPayCheckoutPayload) {
  const params = new URLSearchParams({
    detail: payload.detail,
    amount: payload.amount,
    order_id: payload.orderId,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    hash: senangPayCheckoutHash(payload),
  });
  return `${configuredBaseUrl()}/${encodeURIComponent(senangPayMerchantId())}?${params.toString()}`;
}

export function senangPayCheckoutHash(payload: Pick<SenangPayCheckoutPayload, "detail" | "amount" | "orderId">) {
  return senangPayHash(`${senangPaySecretKey()}${payload.detail}${payload.amount}${payload.orderId}`);
}

export function senangPayCallbackHash(payload: Pick<SenangPayCallbackPayload, "statusId" | "orderId" | "transactionId" | "message">) {
  return senangPayHash(`${senangPaySecretKey()}${payload.statusId}${payload.orderId}${payload.transactionId}${payload.message}`);
}

export function verifySenangPayCallback(payload: SenangPayCallbackPayload) {
  const expected = senangPayCallbackHash(payload);
  const received = String(payload.hash || "").trim().toLowerCase();
  if (!received || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function parseSenangPayParams(searchParams: URLSearchParams): SenangPayCallbackPayload {
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });

  return {
    statusId: String(searchParams.get("status_id") ?? searchParams.get("txn_status") ?? searchParams.get("status") ?? "").trim(),
    orderId: String(searchParams.get("order_id") ?? "").trim(),
    transactionId: String(searchParams.get("transaction_id") ?? searchParams.get("txn_ref") ?? searchParams.get("ref_id") ?? "").trim(),
    message: String(searchParams.get("msg") ?? searchParams.get("txn_msg") ?? searchParams.get("message") ?? "").trim(),
    hash: String(searchParams.get("hash") ?? searchParams.get("hashed_value") ?? searchParams.get("signature") ?? "").trim(),
    raw,
  };
}

export async function parseSenangPayRequest(req: Request) {
  const url = new URL(req.url);
  if (req.method !== "POST") return parseSenangPayParams(url.searchParams);

  const body = await req.text();
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const params = new URLSearchParams();
    const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
    Object.entries(parsed).forEach(([key, value]) => {
      if (value !== null && value !== undefined) params.set(key, String(value));
    });
    return parseSenangPayParams(params);
  }

  return parseSenangPayParams(new URLSearchParams(body));
}

export function amountForSenangPay(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("SenangPay amount must be greater than zero.");
  }
  return amount.toFixed(2);
}