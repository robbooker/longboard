# Private room summaries

Type `/summary` in the room composer to summarize the current room, or choose `/summary LB`, `/summary SOCIAL`, or `/summary SS`. Internal room names `main`, `social`, `shortscout` also work. Invalid names show guidance without posting a public message. The command opens a read-only **@Buddy · Room summaries** conversation in the private inbox after delivery.

The summary covers the latest 50 messages, includes the actual message count and the newest source timestamp, and asks the existing chat AI model for concise topics, key messages and unresolved questions. Empty rooms deliver a clear empty summary without an AI call. All three rooms are supported according to the requesting user's current entitlements. Source text is treated as untrusted data, not executable instructions. Nothing is posted to the room or sent to another member.

Each room has a server-only cache lasting ten minutes. Every request reads the latest 50 rows and hashes their IDs, text, authors and timestamps. Posts, edits, deletions or author changes therefore invalidate matching on the next request; there is no background regeneration. A 90-second database lease prevents simultaneous generation for the same room. Failed generation clears its lease; abandoned leases expire. A summary reflects the snapshot at request time, so messages arriving during generation are included in the next request rather than changing an in-flight response.

There is a 15-second per-account cooldown. Requests use a client UUID to deduplicate delivery retries. Private deliveries are stored separately from human DM requests and cannot be replied to, blocked or reported as another member. The inbox rechecks current room permissions when listing or reading summaries and marking them read. All summary tables and RPCs deny browser roles; the API derives the recipient account from verified authentication. Losing access to SS removes SS summaries from subsequent inbox responses. Summaries already delivered preserve their historical snapshot; deleting a room message does not retroactively rewrite a previously delivered summary.

## Rollout and verification

Apply `20260916211649_chat_room_summary_inbox.sql` before deploying. No extra secret or provider is required; generation uses the existing `OPENAI_API_KEY` and chat model. The migration is additive and server-only. The room cache and private deliveries are not added to public realtime feeds or search.

Run `node scripts/tests/chat-room-summary-database.mjs`, `npm test`, TypeScript, targeted lint and production build. Local browser verification uses a seeded summary cache with dummy users to exercise the real slash-command API, private delivery, inbox read, invalid command guidance and mobile layout without sending test transcripts to an external model. Generation behavior is unit-tested with a mocked AI response.
