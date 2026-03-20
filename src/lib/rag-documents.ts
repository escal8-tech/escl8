export const DOC_TYPES = ["considerations", "conversations", "inventory", "bank", "address"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const KEY_DOC_TYPES = ["considerations", "conversations", "inventory"] as const;
export type KeyDocType = (typeof KEY_DOC_TYPES)[number];

export const INDEXING_STATUS = {
  NOT_INDEXED: "not_indexed",
  QUEUED: "queued",
  INDEXING: "indexing",
  INDEXED: "indexed",
  FAILED: "failed",
} as const;
export type IndexingStatus = (typeof INDEXING_STATUS)[keyof typeof INDEXING_STATUS];

export const RAG_JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;
export type RagJobStatus = (typeof RAG_JOB_STATUS)[keyof typeof RAG_JOB_STATUS];

export type DocSlot = {
  key: DocType;
  title: string;
  hint: string;
  accept: string;
};

export const DOC_SLOTS: readonly DocSlot[] = [
  {
    key: "considerations",
    title: "AI Agent Considerations",
    hint: "Guidelines, policies, and constraints the agent should follow.",
    accept: ".pdf,.txt,.doc,.docx",
  },
  {
    key: "conversations",
    title: "AI Agent Conversations",
    hint: "Sample dialogues/Q&A to teach tone and common responses.",
    accept: ".pdf,.txt,.doc,.docx",
  },
  {
    key: "inventory",
    title: "Live Stock List / Prices",
    hint: "Inventory list, SKUs, and pricing details.",
    accept: ".pdf,.csv,.txt",
  },
  {
    key: "bank",
    title: "Bank Account Details",
    hint: "Payment account information for customer instructions.",
    accept: ".pdf,.txt,.doc,.docx",
  },
  {
    key: "address",
    title: "Shop Address & Location",
    hint: "Store address, location, and directions.",
    accept: ".pdf,.txt,.doc,.docx",
  },
];

export function isDocType(value: unknown): value is DocType {
  return typeof value === "string" && (DOC_TYPES as readonly string[]).includes(value);
}

export function isKeyDocType(value: unknown): value is KeyDocType {
  return typeof value === "string" && (KEY_DOC_TYPES as readonly string[]).includes(value);
}

export function normalizeIndexingStatus(value: unknown): IndexingStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if ((Object.values(INDEXING_STATUS) as readonly string[]).includes(normalized)) {
    return normalized as IndexingStatus;
  }
  return INDEXING_STATUS.NOT_INDEXED;
}

export function isTrainingIndexingStatus(value: unknown): boolean {
  const status = normalizeIndexingStatus(value);
  return status === INDEXING_STATUS.QUEUED || status === INDEXING_STATUS.INDEXING;
}

export function isIndexedIndexingStatus(value: unknown): boolean {
  return normalizeIndexingStatus(value) === INDEXING_STATUS.INDEXED;
}

export function getDocTitle(docType: DocType): string {
  return DOC_SLOTS.find((slot) => slot.key === docType)?.title || docType;
}

export function buildDocTypeRecord<T>(factory: () => T): Record<DocType, T> {
  return {
    considerations: factory(),
    conversations: factory(),
    inventory: factory(),
    bank: factory(),
    address: factory(),
  };
}
