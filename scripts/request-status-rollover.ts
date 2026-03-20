import "dotenv/config";

import { sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { businesses, requests } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { publishPortalEvent } from "../src/server/realtime/portalEvents";
import { recordBusinessEvent } from "../src/lib/business-monitoring";
import { registerNodeRuntimeMonitoring } from "../src/lib/node-runtime-monitoring";
import { captureSentryException } from "../src/lib/sentry-monitoring";

const JOB_NAME = "requests_rollover";

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveBusinessTimezone(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "UTC";
  return isValidTimezone(raw.trim()) ? raw.trim() : "UTC";
}

async function rolloverBusinessRequests(businessId: string, timezone: string): Promise<number> {
  const result = await db.execute<{ updated_count: number }>(sql`
    WITH updated AS (
      UPDATE ${requests}
      SET status = 'completed', updated_at = now()
      WHERE ${requests.businessId} = ${businessId}
        AND ${requests.status} = 'ongoing'
        AND ${requests.deletedAt} IS NULL
        AND ${requests.createdAt} < ((date_trunc('day', now() AT TIME ZONE ${timezone})) AT TIME ZONE ${timezone})
      RETURNING 1
    )
    SELECT count(*)::int AS updated_count FROM updated;
  `);

  const count = Number(result.rows?.[0]?.updated_count ?? 0);
  return Number.isFinite(count) ? count : 0;
}

async function main() {
  registerNodeRuntimeMonitoring();

  const rows = await db
    .select({ id: businesses.id, settings: businesses.settings, isActive: businesses.isActive })
    .from(businesses)
    .where(eq(businesses.isActive, true));

  recordBusinessEvent({
    event: "job.requests_rollover.started",
    action: "request_rollover_start",
    area: "cron",
    source: "cron",
    outcome: "started",
    status: "started",
    attributes: {
      business_count: rows.length,
      job_name: JOB_NAME,
    },
  });

  let totalUpdated = 0;
  for (const row of rows) {
    const timezone = resolveBusinessTimezone((row.settings as Record<string, unknown> | null)?.timezone);
    const updated = await rolloverBusinessRequests(row.id, timezone);
    totalUpdated += updated;

    if (updated > 0) {
      await publishPortalEvent({
        businessId: row.id,
        entity: "request",
        op: "bulk_rollover",
        entityId: null,
        payload: {
          rollover: {
            updatedCount: updated,
            timezone,
          },
        },
      });

      recordBusinessEvent({
        event: "request.bulk_rollover_applied",
        action: "bulk_rollover",
        area: "request",
        businessId: row.id,
        source: "cron",
        outcome: "success",
        status: "completed",
        attributes: {
          job_name: JOB_NAME,
          timezone,
          updated_count: updated,
        },
      });
    }

    console.log(
      "[request-rollover] businessId=%s timezone=%s updated=%d",
      row.id,
      timezone,
      updated,
    );
  }

  recordBusinessEvent({
    event: "job.requests_rollover.completed",
    action: "request_rollover_complete",
    area: "cron",
    source: "cron",
    outcome: "success",
    status: "completed",
    attributes: {
      business_count: rows.length,
      job_name: JOB_NAME,
      total_updated: totalUpdated,
    },
  });

  console.log("[request-rollover] done businesses=%d totalUpdated=%d", rows.length, totalUpdated);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    captureSentryException(err, {
      action: "job.requests_rollover.run",
      area: "cron",
      level: "error",
      tags: {
        "job.name": JOB_NAME,
      },
      contexts: {
        job: {
          name: JOB_NAME,
        },
      },
    });
    recordBusinessEvent({
      event: "job.requests_rollover.failed",
      level: "error",
      action: "request_rollover_failed",
      area: "cron",
      source: "cron",
      outcome: "failed",
      status: "failed",
      attributes: {
        error_message: err instanceof Error ? err.message : String(err),
        job_name: JOB_NAME,
      },
    });
    console.error("[request-rollover] failed", err);
    process.exit(1);
  });
