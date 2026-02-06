"use client";

import { useEffect } from "react";
import { trpc } from "@/utils/trpc";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type MaybePhoneFilter = {
  whatsappIdentityId?: string | null;
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
  customerListInput?: MaybePhoneFilter;
  messagesThreadListInput?: ThreadListInput;
  activeThreadId?: string | null;
  activeThreadPageSize?: number;
  onThreadMessage?: (message: MessageRow) => void;
};

type PortalEvent = {
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
  const threadsList = utils.messages.listRecentThreads as any;
  const messagesList = utils.messages.listMessages as any;

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const applyEvent = (event: PortalEvent) => {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const phoneIdentityId = eventPhoneIdentity(payload);

      const customerFilter = options.customerListInput?.whatsappIdentityId;
      const requestFilter = options.requestListInput?.whatsappIdentityId;
      const threadFilter = options.messagesThreadListInput?.whatsappIdentityId;

      const customerMatchesFilter = !customerFilter || customerFilter === phoneIdentityId;
      const requestMatchesFilter = !requestFilter || requestFilter === phoneIdentityId;
      const threadMatchesFilter = !threadFilter || threadFilter === phoneIdentityId;

      const maybeCustomer = payload.customer as Record<string, unknown> | undefined;
      if (maybeCustomer && customerMatchesFilter) {
        let nextCustomers: Array<Record<string, unknown>> = [];
        const customerInput = options.customerListInput;
        customersList.setData(customerInput, (old: Array<Record<string, unknown>> | undefined) => {
          nextCustomers = upsertById(old, maybeCustomer);
          return nextCustomers;
        });

        if (!customerInput) {
          customersStats.setData(undefined, computeCustomerStats(nextCustomers));
        }
      }

      const maybeRequest = payload.request as Record<string, unknown> | undefined;
      if (maybeRequest && requestMatchesFilter && options.requestListInput) {
        const limit = options.requestListInput.limit ?? 100;
        let nextRequests: Array<Record<string, unknown>> = [];
        requestsList.setData(options.requestListInput, (old: Array<Record<string, unknown>> | undefined) => {
          nextRequests = upsertById(old, maybeRequest).slice(0, limit);
          return nextRequests;
        });

        requestsStats.setData(options.requestStatsInput, computeRequestStats(nextRequests));
      }

      const maybeThread = payload.thread as Record<string, unknown> | undefined;
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

      const maybeMessage = payload.message as MessageRow | undefined;
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

        controller = new AbortController();
        const response = await fetch("/api/events/stream", {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok || !response.body) {
          reconnectTimer = setTimeout(connect, 2000);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const splitIndex = buffer.indexOf("\n\n");
            if (splitIndex === -1) break;

            const chunk = buffer.slice(0, splitIndex);
            buffer = buffer.slice(splitIndex + 2);

            const dataLines = chunk
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim());

            if (!dataLines.length) continue;
            const data = dataLines.join("\n");
            if (!data || data === "[keepalive]") continue;

            try {
              const event = JSON.parse(data) as PortalEvent;
              applyEvent(event);
            } catch {
              // ignore malformed event chunks
            }
          }
        }
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
      if (controller) controller.abort();
    };
  }, [
    options.customerListInput,
    options.requestListInput,
    options.requestStatsInput,
    options.messagesThreadListInput,
    options.activeThreadId,
    options.activeThreadPageSize,
    options.onThreadMessage,
    customersList,
    customersStats,
    requestsList,
    requestsStats,
    threadsList,
    messagesList,
  ]);
}
