# Member chat and search rollout

## Prepared in this change

- Server-rendered /chat requires a verified Longboard profile; signed-out visitors return through login to their original room/popout.
- Chat API status and all writes require authentication; old guest tokens cannot post. Historical guest posts remain searchable. New human messages require a linked member identity.
- Database migration revokes anonymous history/reaction reads and limits authenticated reads to accounts with profiles. Search/context RPCs run as their caller under RLS, never service-role search.
- Search tab offers indexed word/phrase lookup in Main, Social or both, 20 results/page with timestamp+ID cursor, and five surrounding messages each side of a result. DMs are excluded. Search state persists when returning to the same room tab.
- No production changes yet. No embedding requests or historical exports were made.

PR234's compact header is the base for this work. Merge the header before this feature, or include its commits when releasing this feature. Apply 20260915225504_member_chat_search.sql and deploy the code together: the migration removes anonymous access immediately, even for old clients. Already-downloaded public history cannot be recalled from visitors' browsers.

## Vector search setup still needed

Read-only production inspection confirmed the vector extension is available but not installed. No separate vector database subscription is needed.

1. Enable pgvector via a reviewed migration. Add a service-written chunk table containing room, source message IDs, source time range, content hash, embedding model/version and embedding. Add a source-to-chunk mapping with delete/rebuild handling. Keep original messages authoritative.
2. Start with OpenAI text-embedding-3-small (1536 dimensions by default). Configure a server-only embedding model setting and verify the existing OPENAI_API_KEY used by Buddy has Embeddings API access and billing. Never expose that key to the browser. No new key has been requested or verified for embeddings yet.
3. Implement a resumable background indexer with bounded batches, retries, idempotency and cost/usage visibility. It should process Main and Social only, build short contextual windows without crossing rooms, and backfill historical messages. On edits/deletions regenerate affected windows. Sending a chat message must not wait for embedding generation.
4. Add hybrid retrieval combining keyword matches and vector similarity, filtered to the member's allowed rooms/date range. Parse time phrases explicitly, show source excerpts, and provide the same conversation-context view. Do not imply that semantic relevance is factual verification. Start with retrieval; synthesized answers need a separate grounded-answer design.
5. Test representative questions and exact ticker queries, inspect retrieval quality and query plans, and only then choose an approximate vector index if data size warrants it. Set result limits and server-side request limits before exposing paid per-query embeddings.

User setup: likely no new service account. Confirm Embeddings access/billing for the existing OpenAI project if it cannot be verified through the deployment. Everything else above is implementation/deployment work. Historical room messages and search queries will be sent to the embedding provider when this layer is activated; private messages will not. Current release only builds local database text indexes.

Official model reference: https://developers.openai.com/api/docs/models/text-embedding-3-small
Vector reference: https://github.com/pgvector/pgvector
