import { parseMoneyValue } from "@/server/services/orderFlow";

export type PaymentProofChecksLike = {
  amountMatch?: boolean | null;
  dateFormatValid?: boolean | null;
  dateNotFuture?: boolean | null;
  proofPresent?: boolean | null;
};

export type PaymentProofAnalysisLike = {
  status?: string | null;
  summary?: string | null;
  checks?: PaymentProofChecksLike | null;
};

export type PaymentBalance = {
  expectedAmount: string | null;
  paidAmount: string | null;
  delta: string | null;
  state: "exact" | "excess" | "owed" | "unknown";
  amountSufficient: boolean | null;
};

function appendSentence(base: string, extra: string): string {
  const left = String(base || "").trim();
  const right = String(extra || "").trim();
  if (!right) return left;
  if (!left) return right;
  if (left.includes(right)) return left;
  const suffix = /[.!?]$/.test(left) ? "" : ".";
  return `${left}${suffix} ${right}`;
}

export function computePaymentBalance(expectedAmount: unknown, paidAmount: unknown): PaymentBalance {
  const expected = parseMoneyValue(expectedAmount);
  const paid = parseMoneyValue(paidAmount);
  if (!expected || !paid) {
    return {
      expectedAmount: expected,
      paidAmount: paid,
      delta: null,
      state: "unknown",
      amountSufficient: null,
    };
  }
  const deltaNumber = Number((Number(paid) - Number(expected)).toFixed(2));
  let state: PaymentBalance["state"] = "exact";
  if (deltaNumber > 0.009) state = "excess";
  if (deltaNumber < -0.009) state = "owed";
  return {
    expectedAmount: expected,
    paidAmount: paid,
    delta: deltaNumber.toFixed(2),
    state,
    amountSufficient: deltaNumber >= -0.01,
  };
}

export function resolvePaymentProofAssessment(input: {
  analysis?: PaymentProofAnalysisLike | null;
  expectedAmount: unknown;
  paidAmount: unknown;
  currency?: string | null;
}): {
  aiCheckStatus: "confirmed" | "invalid" | "manual_review";
  aiCheckNotes: string;
  balance: PaymentBalance;
} {
  const analysis = input.analysis ?? null;
  const checks = analysis?.checks ?? null;
  const balance = computePaymentBalance(input.expectedAmount, input.paidAmount);
  const currency = String(input.currency || "LKR").trim() || "LKR";
  const supportingChecksOkay = Boolean(checks?.proofPresent) && Boolean(checks?.dateFormatValid) && Boolean(checks?.dateNotFuture);
  let aiCheckStatus: "confirmed" | "invalid" | "manual_review" =
    String(analysis?.status || "").trim().toLowerCase() === "passed" ? "confirmed" : "manual_review";
  let aiCheckNotes = String(analysis?.summary || "").trim() || "Payment proof received.";

  if (balance.amountSufficient === false) {
    const shortBy = Number(balance.delta || "0");
    aiCheckStatus = "invalid";
    aiCheckNotes = appendSentence(
      aiCheckNotes,
      `Detected amount is short by ${currency} ${Math.abs(shortBy).toFixed(2)} compared with the amount due.`,
    );
  } else if (balance.amountSufficient === true) {
    if (supportingChecksOkay) {
      aiCheckStatus = "confirmed";
    }
    if (balance.state === "excess") {
      aiCheckNotes = appendSentence(
        aiCheckNotes,
        `Detected amount is ${currency} ${Number(balance.delta || "0").toFixed(2)} above the amount due and still covers the order total.`,
      );
    } else if (balance.state === "exact") {
      aiCheckNotes = appendSentence(aiCheckNotes, "Detected amount covers the amount due.");
    }
  }

  return {
    aiCheckStatus,
    aiCheckNotes,
    balance,
  };
}
