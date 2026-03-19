import { randomUUID } from "node:crypto";

import { recordBusinessEvent } from "@/lib/business-monitoring";
import { captureSentryException } from "@/lib/sentry-monitoring";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type PortalEvent = {
  eventVersion: number;
  eventId: string;
  dedupeKey: string;
  businessId: string;
  entity: string;
  op: string;
  entityId?: string | null;
  payload?: Record<string, JsonValue>;
  createdAt: string;
};

type PublishPortalEventInput = {
  businessId: string;
  entity: string;
  op: string;
  entityId?: string | null;
  payload?: Record<string, JsonValue>;
  dedupeKey?: string;
  createdAt?: Date | string;
};

type WebPubSubClient = {
  sendToGroup(group: string, message: string, options?: { contentType?: string }): Promise<void>;
};

let cachedClient: WebPubSubClient | null = null;

function getWebPubSubClient(): WebPubSubClient | null {
  if (cachedClient) return cachedClient;
  const conn = process.env.WEB_PUBSUB_CONNECTION_STRING || process.env.WEB_PUBSUB_CONN || "";
  const hub = process.env.WEB_PUBSUB_HUB || "portal";
  if (!conn) return null;

  try {
    // Keep this lazy for environments where the package may be omitted.
    const reqFn = eval("require") as NodeRequire;
    const { WebPubSubServiceClient } = reqFn("@azure/web-pubsub");
    cachedClient = new WebPubSubServiceClient(conn, hub);
    return cachedClient;
  } catch (err) {
    recordBusinessEvent({
      event: "realtime.portal_client_init_failed",
      level: "error",
      area: "realtime",
      source: "realtime",
      outcome: "failed",
      entity: "portal_event",
      attributes: {
        error_message: err instanceof Error ? err.message : String(err),
        hub,
      },
    });
    captureSentryException(err, {
      action: "portal-events-init",
      area: "realtime",
      level: "error",
      tags: {
        "realtime.hub": hub,
      },
    });
    return null;
  }
}

function buildDedupeKey(input: PublishPortalEventInput, createdAtIso: string) {
  const entityId = input.entityId ?? "";
  return `${input.entity}:${input.op}:${entityId}:${createdAtIso}`;
}

export async function publishPortalEvent(input: PublishPortalEventInput): Promise<boolean> {
  const client = getWebPubSubClient();
  if (!client) return false;

  const createdAtIso =
    input.createdAt instanceof Date
      ? input.createdAt.toISOString()
      : typeof input.createdAt === "string"
        ? new Date(input.createdAt).toISOString()
        : new Date().toISOString();

  const evt: PortalEvent = {
    eventVersion: 1,
    eventId: randomUUID(),
    dedupeKey: input.dedupeKey || buildDedupeKey(input, createdAtIso),
    businessId: input.businessId,
    entity: input.entity,
    op: input.op,
    entityId: input.entityId ?? null,
    payload: input.payload,
    createdAt: createdAtIso,
  };

  try {
    await client.sendToGroup(`business.${input.businessId}`, JSON.stringify(evt), {
      contentType: "application/json",
    });
    return true;
  } catch (err) {
    recordBusinessEvent({
      event: "realtime.portal_publish_failed",
      level: "error",
      action: input.op,
      area: "realtime",
      businessId: input.businessId,
      entity: input.entity,
      entityId: input.entityId,
      source: "realtime",
      outcome: "failed",
      status: "publish_failed",
      attributes: {
        error_message: err instanceof Error ? err.message : String(err),
      },
    });
    captureSentryException(err, {
      action: "portal-events-publish",
      area: "realtime",
      level: "error",
      tags: {
        "escal8.business_id": input.businessId,
        "realtime.entity": input.entity,
        "realtime.op": input.op,
      },
      contexts: {
        realtime: {
          businessId: input.businessId,
          entity: input.entity,
          entityId: input.entityId,
          op: input.op,
        },
      },
    });
    return false;
  }
}

export type PortalDocumentPayload = {
  id: string;
  docType: string;
  name: string;
  size: number;
  indexingStatus: string;
  lastIndexedAt: string | null;
  lastError: string | null;
  uploadedAt: string | null;
  updatedAt: string;
};

export function toPortalDocumentPayload(row: {
  id: string;
  docType: string;
  originalFilename: string;
  blobPath: string;
  sizeBytes: number | null;
  indexingStatus: string | null;
  lastIndexedAt: Date | string | null;
  lastError: string | null;
  uploadedAt: Date | string | null;
  updatedAt: Date | string;
}): PortalDocumentPayload {
  return {
    id: row.id,
    docType: row.docType,
    name: row.originalFilename || row.blobPath.split("/").slice(-1)[0] || "latest",
    size: Number(row.sizeBytes ?? 0),
    indexingStatus: String(row.indexingStatus ?? "not_indexed"),
    lastIndexedAt: row.lastIndexedAt ? new Date(row.lastIndexedAt).toISOString() : null,
    lastError: row.lastError ?? null,
    uploadedAt: row.uploadedAt ? new Date(row.uploadedAt).toISOString() : null,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
