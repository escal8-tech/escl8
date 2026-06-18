import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { businesses, agents, channelIdentities, trainingDocuments } from "../drizzle/schema";

async function main() {
  console.log("Starting migration to agents...");

  // 1. Select all businesses
  const allBusinesses = await db.select().from(businesses);
  console.log(`Found ${allBusinesses.length} businesses.`);

  for (const biz of allBusinesses) {
    console.log(`Processing business ${biz.id} (${biz.name})...`);

    // 2. Create one default Agent for this business
    const [newAgent] = await db
      .insert(agents)
      .values({
        businessId: biz.id,
        name: "Default Agent",
        botType: "AGENT",
      })
      .returning();

    console.log(`Created default agent ${newAgent.id} for business ${biz.id}.`);

    // 3. Update all channel identities for this business
    const updatedChannels = await db
      .update(channelIdentities)
      .set({ agentId: newAgent.id })
      .where(eq(channelIdentities.businessId, biz.id))
      .returning();

    console.log(`Updated ${updatedChannels.length} channel identities.`);

    // 4. Update all training documents for this business and set indexing_status to 'not_indexed'
    const updatedDocs = await db
      .update(trainingDocuments)
      .set({ agentId: newAgent.id, indexingStatus: "not_indexed" })
      .where(eq(trainingDocuments.businessId, biz.id))
      .returning();

    console.log(`Updated ${updatedDocs.length} training documents.`);
  }

  console.log("Migration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
