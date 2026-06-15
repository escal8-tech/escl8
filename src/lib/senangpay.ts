import "server-only";

// Use Web Crypto API (global crypto) for Edge + Node.js compatibility
const crypto = globalThis.crypto;

function createHash(algorithm: string) {
  return {
    update(data: string) {
      return {
        digest(encoding: "hex") {
          return crypto.subtle.digest(algorithm.toUpperCase(), new TextEncoder().encode(data))
            .then(buffer => Array.from(new Uint8Array(buffer))
              .map(b => b.toString(16).padStart(2, "0"))
              .join(""));
        }
      };
    }
  };
}

function createHmac(algorithm: string, key: string) {
  return {
    async update(data: string) {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(key),
        { name: "HMAC", hash: { name: algorithm.toUpperCase() } },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
      return {
        digest(encoding: "hex") {
          return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
        }
      };
    }
  };
}

function timingSafeEqual(a: Uint8Array | Buffer, b: Uint8Array | Buffer) {
  const arrA = a instanceof Uint8Array ? a : new Uint8Array(a);
  const arrB = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (arrA.length !== arrB.length) return false;
  let result = 0;
  for (let i = 0; i < arrA.length; i++) result |= arrA[i] ^ arrB[i];
  return result === 0;
}

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