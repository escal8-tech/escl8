export type OrderPaymentMethod = "manual" | "cod" | "bank_qr";

export type OrderFlowSettings = {
  ticketToOrderEnabled: boolean;
  paymentMethod: OrderPaymentMethod;
  currency: string;
  bankQr: {
    showQr: boolean;
    showBankDetails: boolean;
    qrImageUrl: string;
    bankName: string;
    accountName: string;
    accountNumber: string;
    accountInstructions: string;
  };
};

export const DEFAULT_ORDER_FLOW_SETTINGS: OrderFlowSettings = {
  ticketToOrderEnabled: false,
  paymentMethod: "manual",
  currency: "LKR",
  bankQr: {
    showQr: true,
    showBankDetails: true,
    qrImageUrl: "",
    bankName: "",
    accountName: "",
    accountNumber: "",
    accountInstructions: "",
  },
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function asString(value: unknown, fallback = ""): string {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function asPaymentMethod(value: unknown): OrderPaymentMethod {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "cod") return "cod";
  if (normalized === "bank_qr" || normalized === "bankqr" || normalized === "bank/qr") return "bank_qr";
  return "manual";
}

export function normalizeOrderFlowSettings(raw: unknown): OrderFlowSettings {
  const root = asObject(raw);
  const nested =
    asObject(root.orderFlow).ticketToOrderEnabled != null ||
    asObject(root.orderFlow).paymentMethod != null ||
    asObject(root.orderFlow).currency != null
      ? asObject(root.orderFlow)
      : asObject(root.orders);
  const bankQrRaw = asObject(nested.bankQr);
  const paymentMethod = asPaymentMethod(nested.paymentMethod);

  return {
    ticketToOrderEnabled: asBool(nested.ticketToOrderEnabled, DEFAULT_ORDER_FLOW_SETTINGS.ticketToOrderEnabled),
    paymentMethod,
    currency: asString(nested.currency, DEFAULT_ORDER_FLOW_SETTINGS.currency).toUpperCase().slice(0, 10),
    bankQr: {
      showQr: asBool(bankQrRaw.showQr, DEFAULT_ORDER_FLOW_SETTINGS.bankQr.showQr),
      showBankDetails: asBool(bankQrRaw.showBankDetails, DEFAULT_ORDER_FLOW_SETTINGS.bankQr.showBankDetails),
      qrImageUrl: asString(bankQrRaw.qrImageUrl),
      bankName: asString(bankQrRaw.bankName),
      accountName: asString(bankQrRaw.accountName),
      accountNumber: asString(bankQrRaw.accountNumber),
      accountInstructions: asString(bankQrRaw.accountInstructions),
    },
  };
}

export function mergeOrderFlowSettings(
  settings: Record<string, unknown> | null | undefined,
  nextOrderFlow: OrderFlowSettings,
): Record<string, unknown> {
  return {
    ...(settings ?? {}),
    orderFlow: {
      ticketToOrderEnabled: nextOrderFlow.ticketToOrderEnabled,
      paymentMethod: nextOrderFlow.paymentMethod,
      currency: nextOrderFlow.currency,
      bankQr: {
        showQr: nextOrderFlow.bankQr.showQr,
        showBankDetails: nextOrderFlow.bankQr.showBankDetails,
        qrImageUrl: nextOrderFlow.bankQr.qrImageUrl,
        bankName: nextOrderFlow.bankQr.bankName,
        accountName: nextOrderFlow.bankQr.accountName,
        accountNumber: nextOrderFlow.bankQr.accountNumber,
        accountInstructions: nextOrderFlow.bankQr.accountInstructions,
      },
    },
  };
}
