"use client";

import { useEffect } from "react";
import { trpc } from "@/utils/trpc";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type MaybePhoneFilter = {
  whatsappIdentityId?: string | null;
  limit?: number;
  cursorUpdatedAt?: string;
  cursorId?: string;
};

type ThreadListInput = {
  limit?: number;
  whatsappIdentityId?: string;
};

type MessageRow = {
  id: string;
  threadId?: string;
  direction: string;
  messageType: string | null;
  textBody: string | null;
  meta: unknown;
  createdAt: string | Date;
};

type LiveSyncOptions = {
  requestListInput?: { limit?: number; whatsappIdentityId?: string };
  requestStatsInput?: MaybePhoneFilter;
  requestActivityInput?: { days?: number; whatsappIdentityId?: string };
  customerListInput?: MaybePhoneFilter;
  messagesThreadListInput?: ThreadListInput;
  bookingsListInput?: { businessId?: string };
  activeThreadId?: string | null;
  activeThreadPageSize?: number;
  onThreadMessage?: (message: MessageRow) => void;
  onEvent?: (event: PortalEvent) => void;
  onCatchup?: () => void | Promise<void>;
};

type PortalEvent = {
  eventVersion?: number;
  eventId?: string;
  dedupeKey?: string;
  businessId: string;
  entity: string;
  op: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

function normalizeStatus(raw: unknown): "ONGOING" | "NEEDS_FOLLOWUP" | "FAILED" | "COMPLETED" {
  const value = String(raw ?? "").toLowerCase();
  if (value === "ongoing") return "ONGOING";
  if (value === "failed") return "FAILED";
  if (value === "completed") return "COMPLETED";
  if (value === "assistance_required" || value === "assistance-required" || value === "needs_followup") {
    return "NEEDS_FOLLOWUP";
  }
  return "ONGOING";
}

function upsertById<T extends { id?: string }>(rows: T[] | undefined, next: T): T[] {
  const current = rows ?? [];
  const id = next.id;
  if (!id) return current;
  const index = current.findIndex((row) => row.id === id);
  if (index === -1) return [next, ...current];
  const copy = current.slice();
  copy[index] = { ...copy[index], ...next };
  return copy;
}

function upsertByKey<T>(rows: T[] | undefined, next: T, key: keyof T): T[] {
  const current = rows ?? [];
  const id = next[key];
  const index = current.findIndex((row) => row[key] === id);
  if (index === -1) return [next, ...current];
  const copy = current.slice();
  copy[index] = { ...copy[index], ...next };
  return copy;
}

function computeRequestStats(rows: Array<Record<string, unknown>>) {
  const bySentiment: Record<string, number> = {};
  const byStatus: Record<string, number> = {
    ONGOING: 0,
    NEEDS_FOLLOWUP: 0,
    FAILED: 0,
    COMPLETED: 0,
  };
  const bySource: Record<string, number> = {};
  let revenue = 0;
  let paidCount = 0;

  for (const row of rows) {
    const sentiment = String(row.sentiment ?? "unknown").toLowerCase();
    bySentiment[sentiment] = (bySentiment[sentiment] ?? 0) + 1;

    const status = normalizeStatus(row.status);
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const source = String(row.source ?? "whatsapp");
    bySource[source] = (bySource[source] ?? 0) + 1;

    if (Boolean(row.paid)) paidCount += 1;
    const price = Number(row.price ?? 0);
    if (!Number.isNaN(price)) revenue += price;
  }

  const total = rows.length;
  const completed = byStatus.COMPLETED;
  const failed = byStatus.FAILED;
  const needsFollowup = byStatus.NEEDS_FOLLOWUP;

  return {
    totals: {
      count: total,
      revenue,
      paidCount,
      deflectionRate: completed + failed > 0 ? completed / (completed + failed) : 0,
      followUpRate: total > 0 ? needsFollowup / total : 0,
    },
    bySentiment,
    byStatus,
    bySource,
  };
}

function computeCustomerStats(rows: Array<Record<string, unknown>>) {
  const totalCustomers = rows.length;
  let totalRevenue = 0;
  let totalLeadScore = 0;
  let highIntentCount = 0;

  for (const row of rows) {
    const revenue = Number(row.totalRevenue ?? 0);
    if (!Number.isNaN(revenue)) totalRevenue += revenue;

    const leadScore = Number(row.leadScore ?? 0);
    if (!Number.isNaN(leadScore)) totalLeadScore += leadScore;

    if (Boolean(row.isHighIntent)) highIntentCount += 1;
  }

  return {
    totalCustomers,
    totalRevenue: String(totalRevenue),
    avgLeadScore: totalCustomers > 0 ? Math.round(totalLeadScore / totalCustomers) : 0,
    highIntentCount,
  };
}

function eventPhoneIdentity(payload: Record<string, unknown>): string | null {
  const customer = payload.customer as Record<string, unknown> | undefined;
  if (customer) {
    const value = customer.whatsappIdentityId ?? customer.whatsapp_identity_id;
    if (typeof value === "string" && value) return value;
  }

  const thread = payload.thread as Record<string, unknown> | undefined;
  if (thread) {
    const value = thread.whatsappIdentityId ?? thread.whatsapp_identity_id;
    if (typeof value === "string" && value) return value;
  }

  const direct = payload.whatsappIdentityId ?? payload.whatsapp_identity_id;
  if (typeof direct === "string" && direct) return direct;

  return null;
}

export function useLivePortalEvents(options: LiveSyncOptions = {}) {
  const utils = trpc.useUtils();
  const customersList = utils.customers.list as any;
  const customersStats = utils.customers.getStats as any;
  const requestsList = utils.requests.list as any;
  const requestsStats = utils.requests.stats as any;
  const requestsActivity = utils.requests.activitySeries as any;
  const threadsList = utils.messages.listRecentThreads as any;
  const messagesList = utils.messages.listMessages as any;
  const bookingsList = utils.bookings.list as any;

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    let ackId = 1;
    let lastCatchupAt = 0;
    let lastActivityInvalidateAt = 0;
    let hasConnectedOnce = false;
    const recentEventKeys = new Map<string, number>();

    const runCatchup = () => {
      const now = Date.now();
      if (now - lastCatchupAt < 3000) return;
      lastCatchupAt = now;

      const jobs: Array<Promise<unknown>> = [];
      if (options.requestListInput) jobs.push(requestsList.invalidate(options.requestListInput));
      if (options.requestStatsInput !== undefined) jobs.push(requestsStats.invalidate(options.requestStatsInput));
      if (options.requestActivityInput) jobs.push(requestsActivity.invalidate(options.requestActivityInput));
      if (options.customerListInput !== undefined) jobs.push(customersList.invalidate(options.customerListInput));
      jobs.push(customersStats.invalidate(undefined));
      if (options.messagesThreadListInput) jobs.push(threadsList.invalidate(options.messagesThreadListInput));
      if (options.bookingsListInput !== undefined) jobs.push(bookingsList.invalidate(options.bookingsListInput));
      if (options.activeThreadId) {
        jobs.push(
          messagesList.invalidate({
            threadId: options.activeThreadId,
            limit: options.activeThreadPageSize ?? 20,
          }),
        );
      }

      void Promise.allSettled(jobs);
      void options.onCatchup?.();
    };

    const applyEvent = (event: PortalEvent) => {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const request = payload.request as Record<string, unknown> | undefined;
      const customer = payload.customer as Record<string, unknown> | undefined;
      const thread = payload.thread as Record<string, unknown> | undefined;
      const message = payload.message as Record<string, unknown> | undefined;
      const booking = payload.booking as Record<string, unknown> | undefined;
      const dedupeId =
        String(event.entityId ?? "") ||
        String(request?.id ?? customer?.id ?? thread?.threadId ?? message?.id ?? "");
      const dedupeStamp = String(
        request?.updatedAt ??
          customer?.updatedAt ??
          thread?.lastMessageAt ??
          message?.createdAt ??
          event.createdAt ??
          "",
      );
      const dedupeKey = event.dedupeKey || event.eventId || `${event.entity}:${event.op}:${dedupeId}:${dedupeStamp}`;
      const now = Date.now();
      const prev = recentEventKeys.get(dedupeKey);
      if (prev && now - prev < 1500) return;
      recentEventKeys.set(dedupeKey, now);
      if (recentEventKeys.size > 300) {
        for (const [k, ts] of recentEventKeys) {
          if (now - ts > 30000) recentEventKeys.delete(k);
        }
      }

      const phoneIdentityId = eventPhoneIdentity(payload);

      const customerFilter = options.customerListInput?.whatsappIdentityId;
      const requestFilter = options.requestListInput?.whatsappIdentityId;
      const threadFilter = options.messagesThreadListInput?.whatsappIdentityId;

      const customerMatchesFilter = !customerFilter || customerFilter === phoneIdentityId;
      const requestMatchesFilter = !requestFilter || requestFilter === phoneIdentityId;
      const threadMatchesFilter = !threadFilter || threadFilter === phoneIdentityId;

      const maybeCustomer = customer;
      if (maybeCustomer && customerMatchesFilter) {
        let nextCustomers: Array<Record<string, unknown>> = [];
        const customerInput = options.customerListInput;
        customersList.setData(customerInput, (old: Array<Record<string, unknown>> | undefined) => {
          if (event.op === "deleted") {
            const targetId = String(maybeCustomer.id ?? event.entityId ?? "");
            nextCustomers = (old ?? []).filter((row) => String(row.id ?? "") !== targetId);
            return nextCustomers;
          }
          nextCustomers = upsertById(old, maybeCustomer);
          return nextCustomers;
        });

        if (!customerInput) {
          customersStats.setData(undefined, computeCustomerStats(nextCustomers));
        }
      }

      const maybeRequest = request;
      if (maybeRequest && requestMatchesFilter && options.requestListInput) {
        const limit = options.requestListInput.limit ?? 100;
        let nextRequests: Array<Record<string, unknown>> = [];
        requestsList.setData(options.requestListInput, (old: Array<Record<string, unknown>> | undefined) => {
          nextRequests = upsertById(old, maybeRequest).slice(0, limit);
          return nextRequests;
        });

        requestsStats.setData(options.requestStatsInput, computeRequestStats(nextRequests));
        if (options.requestActivityInput) {
          const now = Date.now();
          if (now - lastActivityInvalidateAt > 1500) {
            lastActivityInvalidateAt = now;
            void requestsActivity.invalidate(options.requestActivityInput);
          }
        }
      }
      if (!maybeRequest && event.entity === "request" && options.requestListInput) {
        // Bulk request events (like midnight rollover) should refresh request-derived widgets.
        void requestsList.invalidate(options.requestListInput);
        void requestsStats.invalidate(options.requestStatsInput);
        if (options.requestActivityInput) {
          void requestsActivity.invalidate(options.requestActivityInput);
        }
      }

      const maybeThread = thread;
      if (maybeThread && threadMatchesFilter && options.messagesThreadListInput) {
        const threadInput = options.messagesThreadListInput;
        const limit = threadInput.limit ?? 50;
        threadsList.setData(threadInput, (old: Array<Record<string, unknown>> | undefined) => {
          const upserted = upsertByKey(old, maybeThread, "threadId");
          return upserted
            .slice()
            .sort((a, b) => {
              const aTs = new Date(String(a.lastMessageAt ?? a.threadCreatedAt ?? 0)).getTime();
              const bTs = new Date(String(b.lastMessageAt ?? b.threadCreatedAt ?? 0)).getTime();
              return bTs - aTs;
            })
            .slice(0, limit);
        });
      }

      const maybeMessage = message as MessageRow | undefined;
      if (maybeMessage && options.activeThreadId && maybeMessage.threadId === options.activeThreadId) {
        const pageSize = options.activeThreadPageSize ?? 20;
        const listInput = { threadId: options.activeThreadId, limit: pageSize };

        messagesList.setData(
          listInput,
          (old:
            | {
                messages: MessageRow[];
                nextCursor: string | null;
                hasMore: boolean;
              }
            | undefined) => {
            const current = old?.messages ?? [];
            const found = current.some((m) => m.id === maybeMessage.id);
            if (found) return old;

            const next = [...current, maybeMessage].sort(
              (a, b) => new Date(String(a.createdAt)).getTime() - new Date(String(b.createdAt)).getTime(),
            );

            return {
              messages: next,
              nextCursor: old?.nextCursor ?? null,
              hasMore: old?.hasMore ?? false,
            };
          },
        );

        options.onThreadMessage?.(maybeMessage);
      }

      const maybeBooking = booking;
      if (maybeBooking && options.bookingsListInput !== undefined) {
        const bookingInput = options.bookingsListInput;
        bookingsList.setData(bookingInput, (old: Array<Record<string, unknown>> | undefined) => {
          if (event.op === "deleted") {
            const targetId = String(maybeBooking.id ?? event.entityId ?? "");
            return (old ?? []).filter((row) => String(row.id ?? "") !== targetId);
          }
          return upsertById(old, maybeBooking);
        });
      }

      options.onEvent?.(event);
    };

    const connect = async () => {
      if (cancelled) return;

      try {
        const auth = getFirebaseAuth();
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          reconnectTimer = setTimeout(connect, 2000);
          return;
        }

        const response = await fetch("/api/events/negotiate", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!response.ok) {
          reconnectTimer = setTimeout(connect, 2000);
          return;
        }

        const body = (await response.json()) as { url?: string; group?: string; subprotocol?: string };
        const url = body.url || "";
        const group = body.group || "";
        const subprotocol = body.subprotocol || "json.webpubsub.azure.v1";
        if (!url || !group) {
          reconnectTimer = setTimeout(connect, 2000);
          return;
        }

        ws = new WebSocket(url, subprotocol);

        ws.onopen = () => {
          if (!ws || cancelled) return;
          // Join the tenant group once connected so we receive business-scoped broadcasts.
          ws.send(JSON.stringify({ type: "joinGroup", group, ackId: ackId++ }));
          // Only on reconnect (not first connect), force catch-up to reconcile missed events.
          if (hasConnectedOnce) runCatchup();
          hasConnectedOnce = true;
        };

        ws.onmessage = (evt) => {
          if (cancelled) return;
          try {
            const parsed = JSON.parse(String(evt.data ?? ""));
            if (!parsed || typeof parsed !== "object") return;

            // Web PubSub "message" envelope.
            if ((parsed as Record<string, unknown>).type === "message") {
              const data = (parsed as Record<string, unknown>).data;
              const event = typeof data === "string" ? (JSON.parse(data) as PortalEvent) : (data as PortalEvent);
              if (event && typeof event === "object") applyEvent(event);
              return;
            }

            // Allow direct payloads for future transport changes.
            const direct = parsed as PortalEvent;
            if (direct.businessId && direct.entity) applyEvent(direct);
          } catch {
            // ignore malformed chunks
          }
        };

        ws.onclose = () => {
          if (!cancelled) reconnectTimer = setTimeout(connect, 1500);
        };

        ws.onerror = () => {
          // Let onclose handle reconnect.
        };

        return;
      } catch {
        // reconnect below
      }

      if (!cancelled) {
        reconnectTimer = setTimeout(connect, 1500);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [
    options.customerListInput,
    options.requestListInput,
    options.requestStatsInput,
    options.requestActivityInput,
    options.messagesThreadListInput,
    options.bookingsListInput,
    options.activeThreadId,
    options.activeThreadPageSize,
    options.onThreadMessage,
    customersList,
    customersStats,
    requestsList,
    requestsStats,
    requestsActivity,
    threadsList,
    messagesList,
    bookingsList,
    options.onEvent,
    options.onCatchup,
  ]);
}
