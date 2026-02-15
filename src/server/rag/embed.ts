import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  client = new OpenAI({ apiKey: key });
  return client;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const model = process.env.OPENAI_EMBEDDING_MODEL || process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
  const c = getClient();

  const input = texts.map((t) => (t || "").slice(0, 8000));
  const avgChars = input.length
    ? Math.round(input.reduce((sum, t) => sum + t.length, 0) / input.length)
    : 0;

  console.log(`[rag:embed] model=${model} inputs=${input.length} avgChars=${avgChars}`);

  try {
    const res = await c.embeddings.create({ model, input });
    return res.data.map((d) => d.embedding);
  } catch (err: unknown) {
    const maybe = err as { status?: number; response?: { status?: number }; message?: string };
    const status = maybe?.status || maybe?.response?.status;
    const msg = maybe?.message || String(err);
    console.error(`[rag:embed] failed status=${status ?? "?"} message=${msg}`);
    throw err;
  }
}
