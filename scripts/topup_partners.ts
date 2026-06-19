import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { businesses } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("No DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});
const db = drizzle(pool);

async function main() {
  console.log("Topping up partners with 50,000 credits...");
  const partners = await db.select().from(businesses).where(eq(businesses.messageUsageTier, 'partner'));
  
  console.log(`Found ${partners.length} partners.`);
  
  for (const partner of partners) {
    const newPool = (partner.creditPool || 0) + 50000;
    await db.update(businesses).set({ creditPool: newPool }).where(eq(businesses.id, partner.id));
    console.log(`Topped up partner ${partner.id} (${partner.name}): old=${partner.creditPool}, new=${newPool}`);
  }
  
  console.log("Done.");
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
