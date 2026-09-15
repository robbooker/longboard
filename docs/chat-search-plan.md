# Chat search: recommended next phase

Proposal only; this header change adds no search endpoint, index, embedding job or provider dependency.

## Start with the original messages

Keep each message as the source of truth with its stable ID, room, author and timestamp. Existing Main/Social history already lives in longboard_chat_messages, with an index on room_slug and created_at. The 60-message initial fetch and 80-message UI cap limit rendered history, not stored history.

Build authenticated search of Main and Social first, defaulting to the current room. Query the server, with bounded results and cursor pagination; never download the entire archive into the browser. Add date and author filters, result snippets, and a link that loads the original message with neighboring context (including messages older than the current history window). Keep private inbox search separate and enforce conversation membership on the server and in RLS before returning any result, count, snippet or context.

Use a PostgreSQL tsvector + GIN index for word/phrase search. Choose and test text normalization against real trading vocabulary, tickers such as $AAPL, punctuation, prices and member names. Full-text stemming alone does not guarantee literal substring or exact-price matches; add normalized ticker fields or a complementary exact/trigram path based on the agreed UX. Backfill existing messages with a migration plan sized to measured row count and table size, then maintain the index on new/edited messages.

Measure query plans and latency with realistic large datasets before deciding to partition, archive, or introduce another service. Make sure retention rules and backups are explicit; archiving should not silently remove historical search coverage.

## Add semantic search only when useful

For questions such as “what were people saying about dilution last week?”, optionally combine keyword and vector retrieval. Short messages like “yes” need context: build small coherent conversation windows, constrained by room, reply relationships, time gaps and token budget. Never mix rooms or private conversations in a chunk. Store source message IDs, timestamps, content hash and embedding model/version. Return original excerpts, not unsupported reconstructed claims.

Create embeddings asynchronously after messages are saved, with retries and idempotent jobs so provider outages do not delay chat. Backfill in resumable batches, and rebuild/remove affected chunks on edits or deletions. Filter access before returning results and recheck source-message access when opening them. Do not send private messages to an embedding provider without a separately agreed scope and policy.

Vectors supplement the originals; they are neither archival storage nor a replacement for exact ticker search. There is no need to purchase a separate vector database up front: pgvector is an option if later measurements justify semantic search.

References:
- https://www.postgresql.org/docs/17/textsearch-indexes.html
- https://github.com/pgvector/pgvector
