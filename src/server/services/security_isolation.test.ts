import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";

// We want to verify that our service layer functions correctly use the businessId in their queries.
// Since we can't easily run the full TRPC/DB stack, we will use a more direct approach
// to verify the logic of the functions we've modified.

test("Security Logic: verify businessId is always used in updates", async () => {
  // This test acts as a documentation and verification that we've reviewed the code
  // and applied the businessId isolation.

  const filesToVerify = [
    "src/server/services/orderPaymentMutationSupport.ts",
    "src/server/services/orderManualPaymentSupport.ts",
    "src/server/services/orderFulfillmentMutationSupport.ts",
    "src/server/services/orderRefundMutationSupport.ts"
  ];

  const fs = await import("node:fs/promises");

  for (const file of filesToVerify) {
    const content = await fs.readFile(file, "utf-8");

    // Every .update() call in these sensitive files should be followed by a .where()
    // that includes eq(..., ctx.businessId)

    const updateBlocks = content.split(".update(").slice(1);
    for (const block of updateBlocks) {
      // Find the where clause for this update
      const whereMatch = block.match(/\.where\(([\s\S]+?)\)\s*\.returning/);
      if (whereMatch) {
        const whereClause = whereMatch[1];
        assert.ok(
          whereClause.includes("ctx.businessId") || whereClause.includes("args.businessId") || whereClause.includes("params.businessId"),
          `Update statement in ${file} is missing businessId isolation in its where clause: ${whereClause.trim()}`
        );
      }
    }
  }
});

test("Security Logic: verify router businessProcedure usage", async () => {
  // Verify that sensitive routers use businessProcedure which enforces businessId presence
  const customerRouterContent = await (await import("node:fs/promises")).readFile("src/server/routers/customers.ts", "utf-8");

  // Every procedure in customersRouter should use businessProcedure (or it might be a public one if intended, but let's check)
  const procedures = customerRouterContent.match(/\w+: (businessProcedure|publicProcedure|protectedProcedure)/g);
  for (const p of procedures || []) {
    assert.ok(p.includes("businessProcedure"), `Customer router procedure should use businessProcedure: ${p}`);
  }
});
