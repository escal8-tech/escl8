import { Pinecone } from "@pinecone-database/pinecone";

export type PineconeClientConfig = {
  apiKey: string;
  indexName: string;
};

export function getPineconeIndex() {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX_NAME;
  if (!apiKey) throw new Error("Missing PINECONE_API_KEY");
  if (!indexName) throw new Error("Missing PINECONE_INDEX_NAME");

  console.log(`[rag:pinecone] using index=${indexName}`);
  const pc = new Pinecone({ apiKey });
  return pc.index(indexName);
}
