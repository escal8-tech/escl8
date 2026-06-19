import { db } from "../src/server/db";
import { commerceProducts, commerceOffers, agents } from "../drizzle/schema";
import { eq, isNull } from "drizzle-orm";

async function main() {
  const allAgents = await db.select({ id: agents.id, businessId: agents.businessId }).from(agents);
  
  for (const agent of allAgents) {
    const defaultAgentId = agent.id;
    const businessId = agent.businessId;

    // Update products
    const resProd = await db.update(commerceProducts)
      .set({ agentId: defaultAgentId })
      .where(isNull(commerceProducts.agentId));
      // wait, we should only update products belonging to the agent's business!
      // But since we only have 1 agent per business right now, it's fine. Let's do it properly:
  }
}

async function run() {
    const allAgents = await db.select({ id: agents.id, businessId: agents.businessId }).from(agents);
    const agentMap = new Map();
    for (const a of allAgents) {
        if (!agentMap.has(a.businessId)) {
            agentMap.set(a.businessId, a.id);
        }
    }

    console.log("Agent map:", agentMap);

    const prods = await db.select({ id: commerceProducts.id, businessId: commerceProducts.businessId }).from(commerceProducts).where(isNull(commerceProducts.agentId));
    let prodCount = 0;
    for (const p of prods) {
        const agentId = agentMap.get(p.businessId);
        if (agentId) {
            await db.update(commerceProducts).set({ agentId }).where(eq(commerceProducts.id, p.id));
            prodCount++;
        }
    }
    console.log(`Updated ${prodCount} products`);

    const offers = await db.select({ id: commerceOffers.id, businessId: commerceOffers.businessId }).from(commerceOffers).where(isNull(commerceOffers.agentId));
    let offerCount = 0;
    for (const o of offers) {
        const agentId = agentMap.get(o.businessId);
        if (agentId) {
            await db.update(commerceOffers).set({ agentId }).where(eq(commerceOffers.id, o.id));
            offerCount++;
        }
    }
    console.log(`Updated ${offerCount} offers`);

}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
