# Member chat and search rollout

## Prepared, not yet live

The compact LB header, required Longboard login, Search tab, keyword search, and semantic search are on `feat/member-chat-search` (PR235 includes PR234). Production remains on the Main/Social release until rollout.

- `/chat`, history reads and chat writes require a signed-in Longboard account with a profile. Historical guest messages remain available to members.
- Search offers **Meaning + words** (up to 20 ranked sources) and **Words & phrases** (20 per page). Both support Main, Social, or both, and open surrounding original messages. DMs never enter either search path.
- Semantic search uses OpenAI `text-embedding-3-small`, 1536 dimensions, plus PostgreSQL full-text matching using reciprocal rank fusion. The API retrieves with the user's session and RLS, not service-role access.
- Each short message is an individual chunk linked by a cascading foreign key. This intentionally replaces the earlier proposed multi-message windows: exact source identity and deletion/edit handling are simpler, and the result's context view supplies neighboring messages. Topic-window retrieval remains a possible quality improvement.
- A service-only queue claims 32 messages with atomic five-minute leases. Vercel runs `/api/cron/chat-index` every two minutes. Eight failed attempts stop automatic retries for a row. Edits immediately clear the old vector and reset the queue; deletes cascade. Conditional hash + lease writes prevent a late worker from restoring stale content.
- Each member gets 30 paid meaning searches per hour, enforced atomically in the database. Keyword search does not depend on OpenAI. Provider failures show an error; members can choose Words & phrases.
- Index token usage is recorded on source rows (batch usage allocated across rows) and in structured worker logs. Query token counts are logged without query text. Row usage reflects the latest successful embedding, not lifetime billing.

## Required environment

Existing server-only `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`, plus the existing public Supabase URL/key. Rob confirmed OpenAI billing/access is enabled. No new account or key has been requested. Never put the OpenAI or service-role key in a `NEXT_PUBLIC_` variable.

## Rollout

1. Apply `20260915225504_member_chat_search.sql`, then `20260915231144_chat_semantic_search.sql`, coordinated with the application deployment. The first removes anonymous history access immediately. Previously downloaded public messages cannot be recalled.
2. The vector migration enables pgvector and enqueues existing Main/Social messages. It makes no OpenAI requests itself.
3. Deploy PR235 (includes compact header PR234), confirm the existing cron secret is configured, and check the first scheduled index run. The queue drains automatically in bounded batches; sending messages never waits on embeddings.
4. Verify a signed-in meaning search, exact ticker search, room scopes and source context on the deployed app. Review real search relevance before calling the quality evaluation complete. Local tests use synthetic vectors and a mocked provider, not actual OpenAI embeddings.
5. Run Supabase security advisors after applying the migrations. Local tests cover anonymous denial, missing-profile denial, caller RLS, worker permissions, room filtering, edit invalidation, stale leases, retries, deletion cleanup, and rate limits.

The earlier Social migration file `20260915204338_chat_social_room.sql` was already applied remotely as `20260915224133`; do not reapply it.

## Operations

Queue health (service/operator only):

```sql
select count(*) filter (where embedding is not null) as indexed,
       count(*) filter (where embedding is null and attempts < 8) as pending,
       count(*) filter (where embedding is null and attempts >= 8) as needs_attention,
       sum(input_tokens) as latest_index_tokens
from public.longboard_chat_embeddings;
```

After diagnosing and fixing a provider/configuration failure, reset exhausted rows:

```sql
update public.longboard_chat_embeddings
set attempts=0, available_at=now(), lease_id=null
where embedding is null and attempts>=8;
```

No approximate vector index yet: exact retrieval is appropriate for the initial small corpus. Measure query latency and plans as history grows before adding a room-aware HNSW strategy. Search currently retrieves messages; it does not synthesize answers or interpret phrases such as “last Tuesday” as hard date filters. Explicit dates, topic windows, relevance evaluation and additional community membership scopes are later work.

References: [Supabase vector extension](https://supabase.com/docs/guides/database/extensions/pgvector), [OpenAI embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create), [Vercel cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
