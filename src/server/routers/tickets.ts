/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { supportTicketEvents, supportTicketTypes, supportTickets } from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { DEFAULT_TICKET_TYPE_KEYS, ensureDefaultTicketTypes } from "../services/ticketDefaults";
import { publishPortalEvent } from "@/server/realtime/portalEvents";

const ticketStatusSchema = z.enum(["open", "in_progress", "resolved"]);
const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const ticketOutcomeSchema = z.enum(["pending", "won", "lost"]);

function normalizeKey(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getSlaDueAt(priority: z.infer<typeof ticketPrioritySchema>, base = new Date()): Date {
  const byPriority: Record<z.infer<typeof ticketPrioritySchema>, number> = {
    urgent: 60 * 60 * 1000,
    high: 4 * 60 * 60 * 1000,
    normal: 12 * 60 * 60 * 1000,
    low: 24 * 60 * 60 * 1000,
  };
  return new Date(base.getTime() + byPriority[priority]);
}

async function logTicketEvent(params: {
  businessId: string;
  ticketId: string;
  eventType: string;
  actorType: "user" | "bot" | "system";
  actorId?: string | null;
  actorLabel?: string | null;
  payload?: Record<string, unknown>;
}) {
  await db.insert(supportTicketEvents).values({
    businessId: params.businessId,
    ticketId: params.ticketId,
    eventType: params.eventType,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
    payload: params.payload ?? {},
  });
}

export const ticketsRouter = router({
  listTypes: businessProcedure
    .input(z.object({ includeDisabled: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const conditions = [eq(supportTicketTypes.businessId, ctx.businessId)];
      if (!input?.includeDisabled) {
        conditions.push(eq(supportTicketTypes.enabled, true));
      }
      return db
        .select()
        .from(supportTicketTypes)
        .where(and(...conditions))
        .orderBy(supportTicketTypes.sortOrder, supportTicketTypes.label);
    }),

  upsertType: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean().optional(),
        requiredFields: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const requiredFields = (input.requiredFields ?? [])
        .map((x) => normalizeKey(x))
        .filter(Boolean);

      const [existing] = await db
        .select({ key: supportTicketTypes.key })
        .from(supportTicketTypes)
        .where(and(eq(supportTicketTypes.id, input.id), eq(supportTicketTypes.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket type not found" });
      }
      if (!DEFAULT_TICKET_TYPE_KEYS.has(existing.key as any)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only default ticket types can be edited." });
      }

      const [updated] = await db
        .update(supportTicketTypes)
        .set({
          enabled: input.enabled ?? true,
          requiredFields,
          updatedAt: new Date(),
        })
        .where(and(eq(supportTicketTypes.id, input.id), eq(supportTicketTypes.businessId, ctx.businessId)))
        .returning();
      return updated ?? null;
    }),

  deleteType: businessProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async () => {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket types are fixed. Disable instead of deleting." });
    }),

  listTickets: businessProcedure
    .input(
      z.object({
        status: ticketStatusSchema.optional(),
        typeKey: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(supportTickets.businessId, ctx.businessId)];
      if (input?.status) conditions.push(eq(supportTickets.status, input.status));
      if (input?.typeKey) conditions.push(eq(supportTickets.ticketTypeKey, normalizeKey(input.typeKey)));
      return db
        .select()
        .from(supportTickets)
        .where(and(...conditions))
        .orderBy(desc(supportTickets.createdAt))
        .limit(input?.limit ?? 200);
    }),

  createTicket: businessProcedure
    .input(
      z.object({
        ticketTypeKey: z.string().min(1),
        title: z.string().optional(),
        summary: z.string().optional(),
        status: ticketStatusSchema.optional(),
        priority: ticketPrioritySchema.optional(),
        source: z.string().optional(),
        customerId: z.string().optional(),
        threadId: z.string().optional(),
        whatsappIdentityId: z.string().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
        notes: z.string().optional(),
        createdBy: z.enum(["bot", "user", "system"]).optional(),
        slaDueAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const ticketTypeKey = normalizeKey(input.ticketTypeKey);
      const [typeRow] = await db
        .select()
        .from(supportTicketTypes)
        .where(
          and(
            eq(supportTicketTypes.businessId, ctx.businessId),
            eq(supportTicketTypes.key, ticketTypeKey),
          ),
        )
        .limit(1);
      if (!typeRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid ticket type" });
      }
      const [created] = await db
        .insert(supportTickets)
        .values({
          businessId: ctx.businessId,
          ticketTypeId: typeRow.id,
          ticketTypeKey,
          title: input.title?.trim() || null,
          summary: input.summary?.trim() || null,
          status: input.status ?? "open",
          priority: input.priority ?? "normal",
          source: input.source?.trim() || "whatsapp",
          customerId: input.customerId ?? null,
          threadId: input.threadId ?? null,
          whatsappIdentityId: input.whatsappIdentityId ?? null,
          customerName: input.customerName?.trim() || null,
          customerPhone: input.customerPhone?.trim() || null,
          fields: input.fields ?? {},
          notes: input.notes?.trim() || null,
          createdBy: input.createdBy ?? "user",
          outcome: "pending",
          lossReason: null,
          slaDueAt: input.slaDueAt ?? getSlaDueAt(input.priority ?? "normal"),
        })
        .returning();
      if (created) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: created.id,
          eventType: "created",
          actorType: input.createdBy === "bot" ? "bot" : "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? input.createdBy ?? "system",
          payload: {
            status: created.status,
            priority: created.priority,
            outcome: created.outcome,
            slaDueAt: created.slaDueAt ? new Date(created.slaDueAt).toISOString() : null,
          },
        });
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: created.id,
          payload: { ticket: created as any },
          createdAt: created.updatedAt ?? created.createdAt ?? new Date(),
        });
      }
      return created;
    }),

  updateTicketStatus: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        status: ticketStatusSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const nextStatus = input.status;
      const [existing] = await db
        .select({
          status: supportTickets.status,
          resolvedAt: supportTickets.resolvedAt,
          outcome: supportTickets.outcome,
          lossReason: supportTickets.lossReason,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      const [updated] = await db
        .update(supportTickets)
        .set({
          status: nextStatus,
          notes: input.notes?.trim() || null,
          resolvedAt: nextStatus === "resolved" ? now : null,
          outcome: nextStatus === "resolved" ? sql`${supportTickets.outcome}` : "pending",
          lossReason: nextStatus === "resolved" ? sql`${supportTickets.lossReason}` : null,
          closedAt: null,
          updatedAt: now,
        })
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .returning();
      if (updated) {
        if (existing.status !== updated.status) {
          await logTicketEvent({
            businessId: ctx.businessId,
            ticketId: updated.id,
            eventType: "status_changed",
            actorType: "user",
            actorId: ctx.userId ?? ctx.firebaseUid ?? null,
            actorLabel: ctx.userEmail ?? "user",
            payload: {
              from: existing.status,
              to: updated.status,
              resolvedAt: updated.resolvedAt ? new Date(updated.resolvedAt).toISOString() : null,
            },
          });
        }
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: updated.id,
          payload: { ticket: updated as any },
          createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
        });
      }
      return updated ?? null;
    }),

  updateTicketOutcome: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        outcome: ticketOutcomeSchema,
        lossReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({
          status: supportTickets.status,
          outcome: supportTickets.outcome,
          lossReason: supportTickets.lossReason,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      if (existing.status !== "resolved" && input.outcome !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only resolved tickets can be marked won/lost." });
      }

      const normalizedLossReason = input.lossReason?.trim() || null;
      if (input.outcome === "lost" && !normalizedLossReason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Loss reason is required when outcome is lost." });
      }

      const [updated] = await db
        .update(supportTickets)
        .set({
          outcome: input.outcome,
          lossReason: input.outcome === "lost" ? normalizedLossReason : null,
          updatedAt: new Date(),
        })
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .returning();

      if (updated) {
        if (existing.outcome !== updated.outcome || (existing.lossReason ?? "") !== (updated.lossReason ?? "")) {
          await logTicketEvent({
            businessId: ctx.businessId,
            ticketId: updated.id,
            eventType: "outcome_changed",
            actorType: "user",
            actorId: ctx.userId ?? ctx.firebaseUid ?? null,
            actorLabel: ctx.userEmail ?? "user",
            payload: {
              from: existing.outcome,
              to: input.outcome,
              previousLossReason: existing.lossReason ?? null,
              lossReason: input.outcome === "lost" ? normalizedLossReason : null,
            },
          });
        }
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: updated.id,
          payload: { ticket: updated as any },
          createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
        });
      }
      return updated ?? null;
    }),

  updateTicketSlaDueAt: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        slaDueAt: z.coerce.date().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({ slaDueAt: supportTickets.slaDueAt })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }

      const [updated] = await db
        .update(supportTickets)
        .set({
          slaDueAt: input.slaDueAt,
          updatedAt: new Date(),
        })
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .returning();

      if (updated) {
        const fromIso = existing.slaDueAt ? new Date(existing.slaDueAt).toISOString() : null;
        const toIso = updated.slaDueAt ? new Date(updated.slaDueAt).toISOString() : null;
        if (fromIso !== toIso) {
          await logTicketEvent({
            businessId: ctx.businessId,
            ticketId: updated.id,
            eventType: "sla_changed",
            actorType: "user",
            actorId: ctx.userId ?? ctx.firebaseUid ?? null,
            actorLabel: ctx.userEmail ?? "user",
            payload: {
              from: fromIso,
              to: toIso,
            },
          });
        }
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: updated.id,
          payload: { ticket: updated as any },
          createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
        });
      }
      return updated ?? null;
    }),

  listTicketEvents: businessProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(supportTicketEvents)
        .where(and(eq(supportTicketEvents.businessId, ctx.businessId), eq(supportTicketEvents.ticketId, input.ticketId)))
        .orderBy(desc(supportTicketEvents.createdAt))
        .limit(input.limit ?? 100);
    }),

  getPerformance: businessProcedure
    .input(
      z
        .object({
          typeKey: z.string().optional(),
          windowDays: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const whereChunks = [sql`${supportTickets.businessId} = ${ctx.businessId}`];
      if (input?.typeKey) {
        whereChunks.push(sql`${supportTickets.ticketTypeKey} = ${normalizeKey(input.typeKey)}`);
      }
      if (input?.windowDays) {
        whereChunks.push(sql`${supportTickets.createdAt} >= now() - (${input.windowDays} * interval '1 day')`);
      }

      const whereSql = sql.join(whereChunks, sql` AND `);
      const result = await db.execute<{
        total: number;
        overdue_open: number;
        resolved_total: number;
        resolved_on_time: number;
        resolved_late: number;
        won_count: number;
        lost_count: number;
      }>(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (
            WHERE ${supportTickets.status} IN ('open','in_progress')
            AND ${supportTickets.slaDueAt} IS NOT NULL
            AND ${supportTickets.slaDueAt} < now()
          )::int AS overdue_open,
          count(*) FILTER (WHERE ${supportTickets.status} = 'resolved')::int AS resolved_total,
          count(*) FILTER (
            WHERE ${supportTickets.status} = 'resolved'
            AND ${supportTickets.resolvedAt} IS NOT NULL
            AND ${supportTickets.slaDueAt} IS NOT NULL
            AND ${supportTickets.resolvedAt} <= ${supportTickets.slaDueAt}
          )::int AS resolved_on_time,
          count(*) FILTER (
            WHERE ${supportTickets.status} = 'resolved'
            AND ${supportTickets.resolvedAt} IS NOT NULL
            AND ${supportTickets.slaDueAt} IS NOT NULL
            AND ${supportTickets.resolvedAt} > ${supportTickets.slaDueAt}
          )::int AS resolved_late,
          count(*) FILTER (WHERE ${supportTickets.outcome} = 'won')::int AS won_count,
          count(*) FILTER (WHERE ${supportTickets.outcome} = 'lost')::int AS lost_count
        FROM ${supportTickets}
        WHERE ${whereSql}
      `);

      const row = result.rows?.[0] ?? {
        total: 0,
        overdue_open: 0,
        resolved_total: 0,
        resolved_on_time: 0,
        resolved_late: 0,
        won_count: 0,
        lost_count: 0,
      };
      const won = Number(row.won_count ?? 0);
      const lost = Number(row.lost_count ?? 0);
      const closedDeals = won + lost;
      const resolvedTotal = Number(row.resolved_total ?? 0);
      const resolvedOnTime = Number(row.resolved_on_time ?? 0);

      return {
        total: Number(row.total ?? 0),
        overdueOpen: Number(row.overdue_open ?? 0),
        resolvedTotal,
        resolvedOnTime,
        resolvedLate: Number(row.resolved_late ?? 0),
        wonCount: won,
        lostCount: lost,
        conversionRate: closedDeals > 0 ? Number(((won / closedDeals) * 100).toFixed(1)) : 0,
        slaOnTimeRate: resolvedTotal > 0 ? Number(((resolvedOnTime / resolvedTotal) * 100).toFixed(1)) : 0,
      };
    }),
});

