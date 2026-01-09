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
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const c = getClient();

  const input = texts.map((t) => (t || "").slice(0, 8000));
  const res = await c.embeddings.create({ model, input });
  return res.data.map((d) => d.embedding);
}
