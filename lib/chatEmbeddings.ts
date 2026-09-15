import { createChatAdminClient } from "@/lib/chatAdmin";

export const CHAT_EMBEDDING_MODEL = "text-embedding-3-small";
export async function embedChatText(input: string[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("embeddings_not_configured");
  if (!input.length || input.length > 32 || input.some(text => !text.trim() || text.length > 12000)) throw new Error("invalid_embedding_input");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_EMBEDDING_MODEL, input, dimensions: 1536, encoding_format: "float" }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`embedding_provider_${response.status}`);
  const result = await response.json();
  const rows = result.data as {index:number;embedding:number[]}[];
  if (!Array.isArray(rows) || rows.length !== input.length) throw new Error("invalid_embedding_response");
  rows.sort((a,b)=>a.index-b.index);
  if (rows.some((row,i)=>row.index!==i || !Array.isArray(row.embedding) || row.embedding.length!==1536 || row.embedding.some(n=>!Number.isFinite(n)))) throw new Error("invalid_embedding_response");
  return { vectors: rows.map(row=>row.embedding), tokens: Number(result.usage?.total_tokens) || 0 };
}

type Job = {message_id:string;content_hash:string;lease_id:string;content:string};
export async function indexChatBatch() {
  const db = createChatAdminClient();
  if (!db || !process.env.OPENAI_API_KEY) throw new Error("embeddings_not_configured");
  const {data,error} = await db.rpc("claim_longboard_chat_embeddings");
  if (error) throw new Error("embedding_queue_unavailable");
  const jobs = (data ?? []) as Job[];
  if (!jobs.length) return {indexed:0,tokens:0};
  // Failures leave the leases pending; a later scheduled run retries after 5 minutes.
  const result = await embedChatText(jobs.map(job=>job.content));
  let indexed = 0;
  for (const [i,job] of jobs.entries()) {
    const {data:saved,error:saveError} = await db.from("longboard_chat_embeddings").update({
      embedding: JSON.stringify(result.vectors[i]), model: CHAT_EMBEDDING_MODEL,
      indexed_at: new Date().toISOString(), lease_id: null,
      input_tokens: Math.floor(result.tokens/jobs.length) + (i < result.tokens%jobs.length ? 1 : 0),
    }).eq("message_id",job.message_id).eq("content_hash",job.content_hash).eq("lease_id",job.lease_id).select("message_id");
    if (saveError) throw new Error("embedding_save_failed");
    indexed += saved?.length ?? 0;
  }
  console.info("[chat-index]", {claimed:jobs.length,indexed,tokens:result.tokens,model:CHAT_EMBEDDING_MODEL});
  return {indexed,tokens:result.tokens};
}
