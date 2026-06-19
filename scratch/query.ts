import { db } from "../src/server/db";
import { commerceProducts, agents } from "../drizzle/schema";

async function main() {
  const prods = await db.select({ id: commerceProducts.id, agentId: commerceProducts.agentId, businessId: commerceProducts.businessId }).from(commerceProducts);
  const agentCount = prods.filter(p => p.agentId).length;
  const noAgentCount = prods.filter(p => !p.agentId).length;
  console.log(`Products with agent: ${agentCount}, Products without agent: ${noAgentCount}`);
  
  const defaultAgent = await db.select({ id: agents.id }).from(agents).limit(1);
  console.log("Default agent ID:", defaultAgent[0]?.id);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
