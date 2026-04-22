/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef } from "react";
import { fetchWithFirebaseAuth } from "@/lib/client-auth-ops";
import { isClientErrorReported } from "@/lib/client-business-monitoring";
import { recordGrafanaLog } from "@/lib/grafana-monitoring";
import { captureSentryException } from "@/lib/sentry-monitoring";
import { trpc } from "@/utils/trpc";

type MaybePhoneFilter = {
  whatsappIdentityId?: string | null;
  limit?: number;
  cursorUpdatedAt?: string;
  cursorId?: string;
};

type RequestPageInput = {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  source?: string;
  sortKey?: "customer" | "status" | "type" | "sentiment" | "created" | "bot";
  sortDir?: "asc" | "desc";
  whatsappIdentityId?: string | null;
};

type CustomerPageInput = {
  source?: string;
  includeDeleted?: boolean;
  whatsappIdentityId?: string | null;
  limit?: number;
  offset?: number;
  search?: string;
  sortKey?: "source" | "name" | "lastMessageAt";
  sortDir?: "asc" | "desc";
};

type ThreadListInput = {
  limit?: number;
  whatsappIdentityId?: string;
};

type TicketListInput = {
  status?: "open" | "in_progress" | "resolved";
  typeKey?: string;
  limit?: number;
};

type TicketLedgerInput = {
  typeKey?: string;
  status?: "open" | "in_progress" | "resolved";
  orderStage?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

type TicketPerformanceInput = {
  typeKey?: string;
  windowDays?: number;
};

type OrderListInput = {
  limit?: number;
  status?: string;
};

type OrderLedgerInput = {
  limit?: number;
  offset?: number;
  search?: string;
  mode?: "payments" | "status" | "revenue";
  queueFilter?: string;
  dateField?: "updatedAt" | "createdAt";
  rangeDays?: number;
  methodFilter?: "all" | "manual" | "bank_qr" | "cod";
};

type OrderOverviewInput = {
  dateField?: "updatedAt" | "createdAt";
  rangeDays?: number;
  methodFilter?: "all" | "manual" | "bank_qr" | "cod";
  mode?: "payments" | "status" | "revenue";
  queueFilter?: string;
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
  requestPageInput?: RequestPageInput;
  requestStatsInput?: MaybePhoneFilter;
  requestActivityInput?: { days?: number; whatsappIdentityId?: string };
  customerListInput?: MaybePhoneFilter;
  customerPageInput?: CustomerPageInput;
  messagesThreadListInput?: ThreadListInput;
  bookingsListInput?: { businessId?: string };
  ticketListInputs?: Array<TicketListInput | undefined>;
  ticketLedgerInput?: TicketLedgerInput;
  ticketPerformanceInput?: TicketPerformanceInput;
  refreshTicketTypeCounters?: boolean;
  orderListInput?: OrderListInput;
  orderLedgerInput?: OrderLedgerInput;
  orderOverviewInput?: OrderOverviewInput;
  activeOrderId?: string | null;
  activeTicketId?: string | null;
  refreshOrderStats?: boolean;
  activeThreadId?: string | null;
  activeThreadPageSize?: number;
  onThreadMessage?: (message: MessageRow) => void;
  onTicket?: (ticket: Record<string, unknown>, event: PortalEvent) => void;
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

const REALTIME_CLIENT_FAILURE_LOG_COOLDOWN_MS = 30_000;

function describeWebSocketReadyState(state: number | undefined): string {
  switch (state) {
    case WebSocket.CONNECTING:
      return "connecting";
    case WebSocket.OPEN:
      return "open";
    case WebSocket.CLOSING:
      return "closing";
    case WebSocket.CLOSED:
      return "closed";
    default:
      return "unknown";
  }
}

function describeWebSocketCloseCode(code: number): string {
  switch (code) {
    case 1000:
      return "normal_closure";
    case 1001:
      return "going_away";
    case 1002:
      return "protocol_error";
    case 1003:
      return "unsupported_data";
    case 1005:
      return "no_status_received";
    case 1006:
      return "abnormal_closure";
    case 1007:
      return "invalid_payload_data";
    case 1008:
      return "policy_violation";
    case 1009:
      return "message_too_big";
    case 1010:
      return "mandatory_extension";
    case 1011:
      return "internal_error";
    case 1012:
      return "service_restart";
    case 1013:
      return "try_again_later";
    case 1015:
      return "tls_handshake_failure";
    default:
      return code >= 4000 ? "application_specific" : "unknown";
  }
}

function getRealtimeSocketHost(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

type BrowserNetworkInformation = {
  downlink?: number;
  effectiveType?: string;
  rtt?: number;
  saveData?: boolean;
};

type RealtimeLogAttributes = Record<string, string | number | boolean | null | undefined>;

function sanitizeRealtimeDetail(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+\b/gi, "Basic [redacted]")
    .replace(/([?&](?:access_token|authorization|code|id_token|refresh_token|token)=)[^&\s]+/gi, "$1[redacted]")
    .trim()
    .slice(0, 500);
}

function getRealtimeRuntimeAttributes(): RealtimeLogAttributes {
  const connection =
    typeof navigator !== "undefined"
      ? ((navigator as Navigator & { connection?: BrowserNetworkInformation }).connection)
      : undefined;

  return {
    browser_online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    document_visibility: typeof document !== "undefined" ? document.visibilityState : undefined,
    network_downlink_mbps: typeof connection?.downlink === "number" ? connection.downlink : undefined,
    network_effective_type: typeof connection?.effectiveType === "string" ? connection.effectiveType : undefined,
    network_rtt_ms: typeof connection?.rtt === "number" ? connection.rtt : undefined,
    network_save_data: typeof connection?.saveData === "boolean" ? connection.saveData : undefined,
  };
}

async function getRealtimeHttpFailureAttributes(response: Response): Promise<RealtimeLogAttributes> {
  const contentType = response.headers.get("content-type") || undefined;
  const attributes: RealtimeLogAttributes = {
    http_content_type: contentType,
    http_status_text: response.statusText || undefined,
  };

  try {
    const text = await response.text();
    if (!text.trim()) return attributes;

    if (contentType?.includes("application/json")) {
      try {
        const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
        const errorText =
          typeof parsed.error === "string"
            ? parsed.error
            : typeof parsed.message === "string"
              ? parsed.message
              : text;
        attributes.http_error = sanitizeRealtimeDetail(errorText);
        return attributes;
      } catch {
        // Fall through to the plain-text body below.
      }
    }

    attributes.http_error = sanitizeRealtimeDetail(text);
  } catch (error) {
    attributes.http_error_read_failed = error instanceof Error ? error.name : "unknown_error";
  }

  return attributes;
}

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

function normalizeTicketStatus(raw: unknown): "open" | "in_progress" | "resolved" {
  const value = String(raw ?? "").toLowerCase();
  if (value === "in_progress") return "in_progress";
  if (value === "resolved" || value === "closed") return "resolved";
  return "open";
}

function normalizeTypeKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function ticketMatchesFilter(ticket: Record<string, unknown>, input?: TicketListInput): boolean {
  if (!input) return true;
  if (input.status) {
    const status = normalizeTicketStatus(ticket.status);
    if (status !== input.status) return false;
  }
  if (input.typeKey) {
    const ticketKey = normalizeTypeKey(ticket.ticketTypeKey ?? ticket.ticket_type_key);
    if (ticketKey !== normalizeTypeKey(input.typeKey)) return false;
  }
  return true;
}

function orderMatchesFilter(order: Record<string, unknown>, input?: OrderListInput): boolean {
  if (!input) return true;
  if (input.status) {
    const status = String(order.status ?? "").trim().toLowerCase();
    if (status !== String(input.status).trim().toLowerCase()) return false;
  }
  return true;
}

export function useLivePortalEvents(options: LiveSyncOptions = {}) {
  const utils = trpc.useUtils();
  const customersList = utils.customers.list as any;
  const customersPage = utils.customers.listPage as any;
  const customersStats = utils.customers.getStats as any;
  const requestsList = utils.requests.list as any;
  const requestsPage = utils.requests.listPage as any;
  const requestsStats = utils.requests.stats as any;
  const requestsActivity = utils.requests.activitySeries as any;
  const threadsList = utils.messages.listRecentThreads as any;
  const messagesList = utils.messages.listMessages as any;
  const bookingsList = utils.bookings.list as any;
  const ticketsList = utils.tickets.listTickets as any;
  const ticketsLedger = utils.tickets.listTicketLedger as any;
  const ticketPerformance = utils.tickets.getPerformance as any;
  const ticketTypeCounters = utils.tickets.getTypeCounters as any;
  const ticketEvents = utils.tickets.listTicketEvents as any;
  const ticketTypesList = utils.tickets.listTypes as any;
  const ticketById = utils.tickets.getTicketById as any;
  const ordersList = utils.orders.listOrders as any;
  const ordersLedger = utils.orders.listOrdersPage as any;
  const ordersOverview = utils.orders.getOverview as any;
  const orderById = utils.orders.getOrderById as any;
  const ordersStats = utils.orders.getStats as any;
  const orderPayments = utils.orders.getOrderPayments as any;
  const orderEvents = utils.orders.getOrderEvents as any;
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingSocketErrorTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    let ackId = 1;
    let lastCatchupAt = 0;
    let lastActivityInvalidateAt = 0;
    let lastOrderStatsInvalidateAt = 0;
    let hasConnectedOnce = false;
    let lastRealtimeClientFailureAt = 0;
    let connectAttempt = 0;
    const recentEventKeys = new Map<string, number>();

    const reportRealtimeClientFailure = (
      message: string,
      attributes: RealtimeLogAttributes = {},
      captureInSentry = true,
      level: "warn" | "error" = "error",
    ) => {
      const now = Date.now();
      if (now - lastRealtimeClientFailureAt < REALTIME_CLIENT_FAILURE_LOG_COOLDOWN_MS) return;
      lastRealtimeClientFailureAt = now;

      const payload = {
        route: window.location.pathname,
        ...attributes,
      };

      recordGrafanaLog(level, message, payload, {
        runtime: "client",
        source: "realtime",
        forceClientDelivery: true,
      });

      if (!captureInSentry) return;

      captureSentryException(new Error(message), {
        action: "realtime-client-failure",
        area: "realtime",
        level: level === "warn" ? "warning" : "error",
        tags: {
          realtime_source: "client",
          realtime_hub: typeof attributes.hub === "string" ? attributes.hub : undefined,
        },
        contexts: {
          realtime: payload,
        },
      });
    };

    const runCatchup = () => {
      const currentOptions = optionsRef.current;
      const now = Date.now();
      if (now - lastCatchupAt < 3000) return;
      lastCatchupAt = now;

      const jobs: Array<Promise<unknown>> = [];
      if (currentOptions.requestListInput) jobs.push(requestsList.invalidate(currentOptions.requestListInput));
      if (currentOptions.requestPageInput) jobs.push(requestsPage.invalidate(currentOptions.requestPageInput));
      if (currentOptions.requestStatsInput !== undefined) jobs.push(requestsStats.invalidate(currentOptions.requestStatsInput));
      if (currentOptions.requestActivityInput) jobs.push(requestsActivity.invalidate(currentOptions.requestActivityInput));
      if (currentOptions.customerListInput !== undefined) jobs.push(customersList.invalidate(currentOptions.customerListInput));
      if (currentOptions.customerPageInput) jobs.push(customersPage.invalidate(currentOptions.customerPageInput));
      jobs.push(customersStats.invalidate(undefined));
      if (currentOptions.messagesThreadListInput) jobs.push(threadsList.invalidate(currentOptions.messagesThreadListInput));
      if (currentOptions.bookingsListInput !== undefined) jobs.push(bookingsList.invalidate(currentOptions.bookingsListInput));
      if (currentOptions.ticketListInputs && currentOptions.ticketListInputs.length > 0) {
        for (const input of currentOptions.ticketListInputs) jobs.push(ticketsList.invalidate(input));
      }
      if (currentOptions.ticketLedgerInput) jobs.push(ticketsLedger.invalidate(currentOptions.ticketLedgerInput));
      if (currentOptions.ticketPerformanceInput) jobs.push(ticketPerformance.invalidate(currentOptions.ticketPerformanceInput));
      if (currentOptions.refreshTicketTypeCounters) jobs.push(ticketTypeCounters.invalidate(undefined));
      if (currentOptions.orderListInput !== undefined) jobs.push(ordersList.invalidate(currentOptions.orderListInput));
      if (currentOptions.orderLedgerInput) jobs.push(ordersLedger.invalidate(currentOptions.orderLedgerInput));
      if (currentOptions.orderOverviewInput) jobs.push(ordersOverview.invalidate(currentOptions.orderOverviewInput));
      if (currentOptions.refreshOrderStats) jobs.push(ordersStats.invalidate(undefined));
      if (currentOptions.activeOrderId) {
        jobs.push(orderById.invalidate({ orderId: currentOptions.activeOrderId }));
        jobs.push(orderPayments.invalidate({ orderId: currentOptions.activeOrderId }));
        jobs.push(orderEvents.invalidate({ orderId: currentOptions.activeOrderId }));
      }
      if (currentOptions.activeTicketId) {
        jobs.push(ticketById.invalidate({ ticketId: currentOptions.activeTicketId }));
        jobs.push(ticketEvents.invalidate({ ticketId: currentOptions.activeTicketId }));
      }
      jobs.push(ticketTypesList.invalidate({ includeDisabled: true }));
      if (currentOptions.activeThreadId) {
        jobs.push(
          messagesList.invalidate({
            threadId: currentOptions.activeThreadId,
            limit: currentOptions.activeThreadPageSize ?? 20,
          }),
        );
      }

      void Promise.allSettled(jobs);
      void currentOptions.onCatchup?.();
    };

    const applyEvent = (event: PortalEvent) => {
      const currentOptions = optionsRef.current;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const request = payload.request as Record<string, unknown> | undefined;
      const customer = payload.customer as Record<string, unknown> | undefined;
      const thread = payload.thread as Record<string, unknown> | undefined;
      const message = payload.message as Record<string, unknown> | undefined;
      const booking = payload.booking as Record<string, unknown> | undefined;
      const ticket = payload.ticket as Record<string, unknown> | undefined;
      const order = payload.order as Record<string, unknown> | undefined;
      const dedupeId =
        String(event.entityId ?? "") ||
        String(request?.id ?? customer?.id ?? thread?.threadId ?? message?.id ?? order?.id ?? "");
      const dedupeStamp = String(
        request?.updatedAt ??
          customer?.updatedAt ??
          thread?.lastMessageAt ??
          ticket?.updatedAt ??
          ticket?.createdAt ??
          order?.updatedAt ??
          order?.createdAt ??
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

      const customerFilter =
        currentOptions.customerListInput?.whatsappIdentityId
        ?? currentOptions.customerPageInput?.whatsappIdentityId;
      const requestFilter =
        currentOptions.requestListInput?.whatsappIdentityId
        ?? currentOptions.requestPageInput?.whatsappIdentityId;
      const threadFilter = currentOptions.messagesThreadListInput?.whatsappIdentityId;

      const customerMatchesFilter = !customerFilter || customerFilter === phoneIdentityId;
      const requestMatchesFilter = !requestFilter || requestFilter === phoneIdentityId;
      const threadMatchesFilter = !threadFilter || threadFilter === phoneIdentityId;

      const maybeCustomer = customer;
      if (maybeCustomer && customerMatchesFilter) {
        let nextCustomers: Array<Record<string, unknown>> = [];
        const customerInput = currentOptions.customerListInput;
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

        if (currentOptions.customerPageInput) {
          void customersPage.invalidate(currentOptions.customerPageInput);
        }

        if (currentOptions.requestListInput) {
          const customerId = String(maybeCustomer.id ?? "");
          const nextBotPaused = maybeCustomer.botPaused ?? maybeCustomer.bot_paused;
          if (customerId && typeof nextBotPaused !== "undefined") {
            requestsList.setData(currentOptions.requestListInput, (old: Array<Record<string, unknown>> | undefined) => {
              if (!old?.length) return old;
              let changed = false;
              const nextRows = old.map((row) => {
                const rowCustomerId = String(row.customerId ?? row.customer_id ?? "");
                if (rowCustomerId !== customerId) return row;
                if (Boolean(row.botPaused ?? row.bot_paused) === Boolean(nextBotPaused)) return row;
                changed = true;
                return { ...row, botPaused: Boolean(nextBotPaused) };
              });
              return changed ? nextRows : old;
            });
          }
        }
        if (currentOptions.requestPageInput) {
          void requestsPage.invalidate(currentOptions.requestPageInput);
        }
      }

      const maybeRequest = request;
      if (maybeRequest && requestMatchesFilter && currentOptions.requestPageInput) {
        void requestsPage.invalidate(currentOptions.requestPageInput);
        if (currentOptions.requestStatsInput !== undefined) {
          void requestsStats.invalidate(currentOptions.requestStatsInput);
        }
        if (currentOptions.requestActivityInput) {
          const now = Date.now();
          if (now - lastActivityInvalidateAt > 1500) {
            lastActivityInvalidateAt = now;
            void requestsActivity.invalidate(currentOptions.requestActivityInput);
          }
        }
      }
      if (maybeRequest && requestMatchesFilter && currentOptions.requestListInput) {
        const limit = currentOptions.requestListInput.limit ?? 100;
        let nextRequests: Array<Record<string, unknown>> = [];
        requestsList.setData(currentOptions.requestListInput, (old: Array<Record<string, unknown>> | undefined) => {
          nextRequests = upsertById(old, maybeRequest).slice(0, limit);
          return nextRequests;
        });

        requestsStats.setData(currentOptions.requestStatsInput, computeRequestStats(nextRequests));
        if (currentOptions.requestActivityInput) {
          const now = Date.now();
          if (now - lastActivityInvalidateAt > 1500) {
            lastActivityInvalidateAt = now;
            void requestsActivity.invalidate(currentOptions.requestActivityInput);
          }
        }
      }
      if (!maybeRequest && event.entity === "request" && currentOptions.requestPageInput) {
        void requestsPage.invalidate(currentOptions.requestPageInput);
        void requestsStats.invalidate(currentOptions.requestStatsInput);
        if (currentOptions.requestActivityInput) {
          void requestsActivity.invalidate(currentOptions.requestActivityInput);
        }
      }
      if (!maybeRequest && event.entity === "request" && currentOptions.requestListInput) {
        // Bulk request events (like midnight rollover) should refresh request-derived widgets.
        void requestsList.invalidate(currentOptions.requestListInput);
        void requestsStats.invalidate(currentOptions.requestStatsInput);
        if (currentOptions.requestActivityInput) {
          void requestsActivity.invalidate(currentOptions.requestActivityInput);
        }
      }

      const maybeThread = thread;
      if (maybeThread && threadMatchesFilter && currentOptions.messagesThreadListInput) {
        const threadInput = currentOptions.messagesThreadListInput;
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
      if (maybeMessage && currentOptions.activeThreadId && maybeMessage.threadId === currentOptions.activeThreadId) {
        const pageSize = currentOptions.activeThreadPageSize ?? 20;
        const listInput = { threadId: currentOptions.activeThreadId, limit: pageSize };

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

        currentOptions.onThreadMessage?.(maybeMessage);
      } 

      const maybeBooking = booking;
      if (maybeBooking && currentOptions.bookingsListInput !== undefined) {
        const bookingInput = currentOptions.bookingsListInput;
        bookingsList.setData(bookingInput, (old: Array<Record<string, unknown>> | undefined) => {
          if (event.op === "deleted") {
            const targetId = String(maybeBooking.id ?? event.entityId ?? "");
            return (old ?? []).filter((row) => String(row.id ?? "") !== targetId);
          }
          return upsertById(old, maybeBooking);
        });
      }

      const maybeOrder = order;
      if (event.entity === "order" && currentOptions.orderLedgerInput) {
        void ordersLedger.invalidate(currentOptions.orderLedgerInput);
      }
      if (event.entity === "order" && currentOptions.orderOverviewInput) {
        void ordersOverview.invalidate(currentOptions.orderOverviewInput);
      }
      if (maybeOrder && currentOptions.orderListInput !== undefined) {
        const orderInput = currentOptions.orderListInput;
        const limit = orderInput.limit ?? 200;
        ordersList.setData(
          orderInput,
          (
            old:
              | {
                  settings?: Record<string, unknown>;
                  items?: Array<Record<string, unknown>>;
                }
              | undefined,
          ) => {
            const currentItems = old?.items ?? [];
            const existing = currentItems.find((row) => String(row.id ?? "") === String(maybeOrder.id ?? ""));
            const merged = existing ? { ...existing, ...maybeOrder } : { ...maybeOrder };
            const nextItems = currentItems.filter((row) => String(row.id ?? "") !== String(maybeOrder.id ?? ""));
            const matches = event.op !== "deleted" && orderMatchesFilter(merged, orderInput);
            const items = matches ? [merged, ...nextItems] : nextItems;
            const sorted = items
              .slice()
              .sort((a, b) => {
                const aTs = new Date(String(a.updatedAt ?? a.createdAt ?? 0)).getTime();
                const bTs = new Date(String(b.updatedAt ?? b.createdAt ?? 0)).getTime();
                return bTs - aTs;
              })
              .slice(0, limit);
            return {
              ...(old ?? {}),
              items: sorted,
            };
          },
        );
      } else if (!maybeOrder && event.entity === "order" && currentOptions.orderListInput !== undefined) {
        void ordersList.invalidate(currentOptions.orderListInput);
      }

      if (event.entity === "order" && currentOptions.refreshOrderStats) {
        const now = Date.now();
        if (now - lastOrderStatsInvalidateAt > 1500) {
          lastOrderStatsInvalidateAt = now;
          void ordersStats.invalidate(undefined);
        }
      }
      if (event.entity === "order" && currentOptions.activeOrderId) {
        const activeOrderId = String(currentOptions.activeOrderId);
        const eventOrderId = String(event.entityId ?? maybeOrder?.id ?? "");
        if (activeOrderId && eventOrderId && activeOrderId === eventOrderId) {
          void orderById.invalidate({ orderId: activeOrderId });
          void orderPayments.invalidate({ orderId: activeOrderId });
          void orderEvents.invalidate({ orderId: activeOrderId });
        }
      }

      const maybeTicket = ticket;
      if (event.entity === "ticket" && currentOptions.ticketLedgerInput) {
        void ticketsLedger.invalidate(currentOptions.ticketLedgerInput);
      }
      if (event.entity === "ticket" && currentOptions.ticketPerformanceInput) {
        void ticketPerformance.invalidate(currentOptions.ticketPerformanceInput);
      }
      if (event.entity === "ticket" && currentOptions.refreshTicketTypeCounters) {
        void ticketTypeCounters.invalidate(undefined);
      }
      if (maybeTicket && currentOptions.ticketListInputs && currentOptions.ticketListInputs.length > 0) {
        for (const listInput of currentOptions.ticketListInputs) {
          const limit = listInput?.limit ?? 400;
          ticketsList.setData(listInput, (old: Array<Record<string, unknown>> | undefined) => {
            const current = old ?? [];
            const nextList = current.filter((row) => String(row.id ?? "") !== String(maybeTicket.id ?? ""));
            if (event.op === "deleted") return nextList.slice(0, limit);
            if (!ticketMatchesFilter(maybeTicket, listInput)) return nextList.slice(0, limit);
            const upserted = [{ ...maybeTicket }, ...nextList];
            return upserted
              .slice()
              .sort((a, b) => {
                const aTs = new Date(String(a.updatedAt ?? a.createdAt ?? 0)).getTime();
                const bTs = new Date(String(b.updatedAt ?? b.createdAt ?? 0)).getTime();
                return bTs - aTs;
              })
              .slice(0, limit);
          });
        }
        currentOptions.onTicket?.(maybeTicket, event);
      } else if (!maybeTicket && event.entity === "ticket" && currentOptions.ticketListInputs && currentOptions.ticketListInputs.length > 0) {
        for (const listInput of currentOptions.ticketListInputs) {
          void ticketsList.invalidate(listInput);
        }
      }
      if (event.entity === "ticket" && currentOptions.activeTicketId) {
        const activeTicketId = String(currentOptions.activeTicketId);
        const eventTicketId = String(event.entityId ?? maybeTicket?.id ?? "");
        if (activeTicketId && eventTicketId && activeTicketId === eventTicketId) {
          void ticketById.invalidate({ ticketId: activeTicketId });
          void ticketEvents.invalidate({ ticketId: activeTicketId });
        }
      }

      currentOptions.onEvent?.(event);
    };

    const connect = async () => {
      if (cancelled) return;

      try {
        const attempt = ++connectAttempt;
        const connectStartedAt = Date.now();
        let connectionFailureReported = false;
        let socketOpened = false;
        let socketErrored = false;
        let socketOpenedAt = 0;
        const response = await fetchWithFirebaseAuth("/api/events/negotiate", {
          cache: "no-store",
        }, {
          action: "realtime.connect",
          area: "realtime",
          attributes: { hub: "portal" },
          missingConfigEvent: "realtime.auth_unconfigured",
          missingSessionEvent: "realtime.session_missing",
          onFailure: (_error, report) => {
            reportRealtimeClientFailure(report.event, {
              ...(report.attributes || {}),
              ...getRealtimeRuntimeAttributes(),
              connect_attempt: attempt,
              hub: "portal",
              negotiate_elapsed_ms: Date.now() - connectStartedAt,
            }, report.captureInSentry, report.level);
            connectionFailureReported = true;
          },
          requestFailureEvent: "realtime.negotiate_request_failed",
          tokenFailureEvent: "realtime.auth_token_failed",
        });

        if (!response.ok) {
          const httpFailureAttributes = await getRealtimeHttpFailureAttributes(response);
          reportRealtimeClientFailure(
            "realtime.negotiate_failed",
            {
              ...httpFailureAttributes,
              ...getRealtimeRuntimeAttributes(),
              connect_attempt: attempt,
              hub: "portal",
              http_status: response.status,
              negotiate_elapsed_ms: Date.now() - connectStartedAt,
              reconnect_delay_ms: 2000,
            },
            response.status >= 500,
          );
          reconnectTimer = setTimeout(connect, 2000);
          return;
        }

        const body = (await response.json()) as { group?: string; hub?: string; subprotocol?: string; url?: string };
        const url = body.url || "";
        const group = body.group || "";
        const hub = body.hub || "portal";
        const subprotocol = body.subprotocol || "json.webpubsub.azure.v1";
        const socketHost = getRealtimeSocketHost(url);
        if (!url || !group) {
          reportRealtimeClientFailure(
            "realtime.negotiate_payload_invalid",
            {
              ...getRealtimeRuntimeAttributes(),
              connect_attempt: attempt,
              group_present: Boolean(group),
              hub,
              negotiate_elapsed_ms: Date.now() - connectStartedAt,
              reconnect_delay_ms: 2000,
              url_present: Boolean(url),
            },
            false,
          );
          reconnectTimer = setTimeout(connect, 2000);
          return;
        }

        ws = new WebSocket(url, subprotocol);

        ws.onopen = () => {
          if (!ws || cancelled) return;
          socketOpened = true;
          socketOpenedAt = Date.now();
          if (pendingSocketErrorTimer) {
            clearTimeout(pendingSocketErrorTimer);
            pendingSocketErrorTimer = null;
          }
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

        ws.onclose = (event) => {
          if (pendingSocketErrorTimer) {
            clearTimeout(pendingSocketErrorTimer);
            pendingSocketErrorTimer = null;
          }
          if (!cancelled && !connectionFailureReported) {
            if (event.wasClean && event.code === 1000) {
              connectionFailureReported = true;
            } else {
              const message =
                socketErrored || !socketOpened ? "realtime.websocket_error" : "realtime.websocket_closed";
              const level = event.wasClean ? "warn" : "error";
              reportRealtimeClientFailure(
                message,
                {
                  ...getRealtimeRuntimeAttributes(),
                  close_code: event.code,
                  close_code_label: describeWebSocketCloseCode(event.code),
                  close_clean: event.wasClean,
                  close_reason: event.reason || undefined,
                  connect_attempt: attempt,
                  connect_elapsed_ms: socketOpenedAt ? socketOpenedAt - connectStartedAt : Date.now() - connectStartedAt,
                  group,
                  hub,
                  opened_once: socketOpened,
                  open_duration_ms: socketOpenedAt ? Date.now() - socketOpenedAt : undefined,
                  ready_state: describeWebSocketReadyState(ws?.readyState),
                  reconnect_delay_ms: 1500,
                  socket_errored: socketErrored,
                  subprotocol: ws?.protocol || subprotocol,
                  websocket_host: socketHost,
                },
                !event.wasClean,
                level,
              );
              connectionFailureReported = true;
            }
          }
          if (!cancelled) reconnectTimer = setTimeout(connect, 1500);
        };

        ws.onerror = () => {
          socketErrored = true;
          if (!connectionFailureReported && !pendingSocketErrorTimer) {
            pendingSocketErrorTimer = setTimeout(() => {
              pendingSocketErrorTimer = null;
              if (cancelled || connectionFailureReported) return;
              reportRealtimeClientFailure(
                "realtime.websocket_error",
                {
                  ...getRealtimeRuntimeAttributes(),
                  connect_attempt: attempt,
                  connect_elapsed_ms: socketOpenedAt ? socketOpenedAt - connectStartedAt : Date.now() - connectStartedAt,
                  error_without_close: true,
                  group,
                  hub,
                  opened_once: socketOpened,
                  open_duration_ms: socketOpenedAt ? Date.now() - socketOpenedAt : undefined,
                  ready_state: describeWebSocketReadyState(ws?.readyState),
                  reconnect_delay_ms: 1500,
                  socket_errored: true,
                  subprotocol: ws?.protocol || subprotocol,
                  websocket_host: socketHost,
                },
                true,
                "error",
              );
              connectionFailureReported = true;
            }, 1000);
          }
        };

        return;
      } catch (error) {
        if (!isClientErrorReported(error)) {
          reportRealtimeClientFailure(
            "realtime.connect_exception",
            {
              ...getRealtimeRuntimeAttributes(),
              connect_attempt: connectAttempt,
              hub: "portal",
              error_message: sanitizeRealtimeDetail(error instanceof Error ? error.message : String(error)),
              error_name: error instanceof Error ? error.name : undefined,
              reconnect_delay_ms: 1500,
            },
            true,
          );
        }
      }

      if (!cancelled) {
        reconnectTimer = setTimeout(connect, 1500);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pendingSocketErrorTimer) clearTimeout(pendingSocketErrorTimer);
      if (ws) ws.close();
    };
  }, [
    customersList,
    customersPage,
    customersStats,
    requestsList,
    requestsPage,
    requestsStats,
    requestsActivity,
    threadsList,
    messagesList,
    bookingsList,
    ticketsList,
    ticketsLedger,
    ticketPerformance,
    ticketTypeCounters,
    ticketEvents,
    ticketTypesList,
    ticketById,
    ordersList,
    ordersLedger,
    ordersOverview,
    orderById,
    ordersStats,
    orderPayments,
    orderEvents,
  ]);
}
