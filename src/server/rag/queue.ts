import { QueueServiceClient } from "@azure/storage-queue";

const DEFAULT_QUEUE_NAME = "rag-jobs";

let cachedQueueClient: ReturnType<QueueServiceClient["getQueueClient"]> | null = null;

function getQueueClient() {
  if (cachedQueueClient) return cachedQueueClient;

  const queueName = process.env.RAG_QUEUE_NAME || DEFAULT_QUEUE_NAME;
  const conn =
    process.env.AZURE_QUEUE_CONNECTION_STRING ||
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AZURE_BLOB_CONNECTION_STRING;

  if (!conn) {
    throw new Error("Missing AZURE_QUEUE_CONNECTION_STRING (or AZURE_STORAGE_CONNECTION_STRING/AZURE_BLOB_CONNECTION_STRING)");
  }

  const service = QueueServiceClient.fromConnectionString(conn);
  const queue = service.getQueueClient(queueName);
  queue.messageEncoding = "base64";
  cachedQueueClient = queue;
  return queue;
}

export async function ensureRagQueue() {
  const queue = getQueueClient();
  await queue.createIfNotExists();
  return queue;
}

export async function enqueueRagJobMessage(jobId: string) {
  const queue = await ensureRagQueue();
  const message = JSON.stringify({ jobId });
  await queue.sendMessage(message);
}
