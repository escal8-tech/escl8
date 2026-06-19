import test from "node:test";
import assert from "node:assert/strict";

function filterSubscriptionRecord<T>(record: Record<string, T>, prefix: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(prefix)));
}

test("filterSubscriptionRecord filters keys by prefix", () => {
  const record = {
    "agent.feature1": true,
    "agent.feature2": false,
    "other.feature": true,
  };
  const filtered = filterSubscriptionRecord(record, "agent.");
  assert.deepEqual(filtered, {
    "agent.feature1": true,
    "agent.feature2": false,
  });
});

test("getSubscription logic simulation", () => {
  // Simulating the credit pool and usage logic from businessRouter.ts
  const mockBiz = {
    creditPool: 500,
  };
  const mockAccess = {
    limits: {
      "agent.messages.monthly": "1000",
    },
  };
  const creditsUsed = 200;

  const monthlyCredits = Number(mockAccess.limits["agent.messages.monthly"] || 0);
  const creditsBalance = Math.max(0, mockBiz.creditPool ?? (monthlyCredits - creditsUsed));

  assert.equal(creditsBalance, 500);

  const mockBizNoPool = {
    creditPool: null,
  };
  const creditsBalanceNoPool = Math.max(0, mockBizNoPool.creditPool ?? (monthlyCredits - creditsUsed));
  assert.equal(creditsBalanceNoPool, 800);
});
