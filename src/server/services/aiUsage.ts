import { sum, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiUsageEvents } from "@/../drizzle/schema";

export async function recordAiUsageEvent(input: {
  businessId: string;
  whatsappIdentityId?: string | null;
  customerId?: string | null;
  threadId?: string | null;
  eventType: string;
  source: string;
  credits?: number;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(aiUsageEvents).values({
    businessId: input.businessId,
    whatsappIdentityId: input.whatsappIdentityId ?? null,
    customerId: input.customerId ?? null,
    threadId: input.threadId ?? null,
    eventType: input.eventType,
    source: input.source,
    credits: Math.max(1, Number(input.credits ?? 1)),
    metadata: input.metadata ?? {},
  });
}

export async function getBusinessAiCreditsUsed(businessId: string): Promise<number> {
  const [row] = await db
    .select({
      used: sum(aiUsageEvents.credits),
    })
    .from(aiUsageEvents)
    .where(eq(aiUsageEvents.businessId, businessId));
  return Number(row?.used ?? 0);
}
