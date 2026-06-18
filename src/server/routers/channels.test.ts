import test from "node:test";
import assert from "node:assert/strict";

test("updateChannel logic simulation", () => {
  const business = { creditPool: 1000 };
  const allChannels = [
    { id: "ch1", monthlyCreditLimit: 500, useSharedPool: false },
    { id: "ch2", monthlyCreditLimit: 300, useSharedPool: true },
  ];

  // Test updating ch2 to use private pool with 600 limit
  const input = { id: "ch2", monthlyCreditLimit: 600, useSharedPool: false };

  let newTotal = 0;
  for (const ch of allChannels) {
    const isTarget = ch.id === input.id;
    const limit = isTarget ? (input.monthlyCreditLimit ?? ch.monthlyCreditLimit) : ch.monthlyCreditLimit;
    const shared = isTarget ? (input.useSharedPool ?? ch.useSharedPool) : ch.useSharedPool;

    if (!shared) {
      newTotal += limit;
    }
  }

  assert.equal(newTotal, 1100);
  assert.ok(newTotal > business.creditPool, "Should exceed credit pool");

  // Test updating ch2 to use private pool with 400 limit
  const input2 = { id: "ch2", monthlyCreditLimit: 400, useSharedPool: false };
  let newTotal2 = 0;
  for (const ch of allChannels) {
    const isTarget = ch.id === input2.id;
    const limit = isTarget ? (input2.monthlyCreditLimit ?? ch.monthlyCreditLimit) : ch.monthlyCreditLimit;
    const shared = isTarget ? (input2.useSharedPool ?? ch.useSharedPool) : ch.useSharedPool;

    if (!shared) {
      newTotal2 += limit;
    }
  }
  assert.equal(newTotal2, 900);
  assert.ok(newTotal2 <= business.creditPool, "Should not exceed credit pool");
});
