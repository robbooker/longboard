# S03: Immediate sends and durable Buddy replies

DM and thread composers capture the submitted draft and immediately render a pending row. Sending no longer disables the next draft. The canonical response replaces that row; sidebar/read reconciliation runs independently. Failed messages retain their original client UUID and scanned attachment IDs for explicit retry. Pending rows do not expose persisted-message actions or media fetches.

`send_chat_dm_ack` wraps the existing authorization, pair locking, message request and media scan rules, returning a canonical DM in the same transaction. Existing introductory conversations return no invented message. Current edited/deleted messages are acknowledged without restoring old content.

Buddy work is inserted atomically with an eligible room message. The send endpoint acknowledges persistence before model generation. `after()` accelerates processing; the authenticated minute cron recovers durable work if the request stops. Three attempts, 90-second fenced leases, a 25-second provider timeout and the existing unique reply constraint bound retries and prevent duplicate replies. Workers recheck access, pause state and source edits/deletion before publication. Message status shows thinking/failure separately from the saved member message.

## Verification

- Full unit suite: 542 passing tests.
- Isolated PostgreSQL: 21 DM acknowledgement assertions and 56 Buddy queue assertions, covering authorization, duplicate requests, clean attachment gating, source changes, lease recovery and stale workers.
- Chromium controlled browser: 20 DM sends p95 15.8ms; 20 reply sends p95 16.2ms. Acknowledgements deliberately delayed while the actual isolated database persisted messages. Continued typing, reversed acknowledgements, stable-ID lost-response retry, attachment retention, conversation isolation, closed/reopened threads and mobile layout verified. Targeted introductory request rerun verifies one pending request and null acknowledgement behavior.
- Existing release-service regression suite: 71 tests pass. TypeScript and targeted lint pass.
- Production build passes; existing unrelated PracticeClient accessibility warnings remain.
- No production messages or model calls used for tests.

## Release

Two additive migrations are pinned in `.release/2496bd29-e047-4831-8568-4a7b79745507.json`. Existing RPC signatures remain intact. During a rolling deployment, the queue recognizes a Buddy reply already produced by the previous application and marks the job complete. The reply uniqueness constraint also protects concurrent old/new workers.

The existing `CRON_SECRET` protects the new cron endpoint. Production service-role SELECT/UPDATE privileges on authorization tables were checked read-only; no client grants are expanded. Only the dedicated release service applies migrations and publishes after exact-version owner approval.

## Limits

Optimistic rendering improves perceived send latency; persistence still depends on the network and existing rate limits. Pending drafts are held in memory and are not an offline queue that survives a full reload. Buddy retries can repeat a provider call after a process failure, but save at most one reply. Replies retain a just-acknowledged row for at most 15 seconds across stale reads; later authoritative polling removes deleted rows. Browser timings are local controlled measurements, not production p95 or an end-to-end speedup claim.
