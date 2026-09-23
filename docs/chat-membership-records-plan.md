# Current membership badge integration

Ticket `40795b55-03f9-4322-a885-d7d799e4ee23`. Longboard consumer and display mapping implemented locally. **Not ready for publication:** the corresponding ShortScout producer, scoped signing secret provisioning and coordinated deployment verification remain prerequisites. No production schema, credentials, identity or authorization changes have been made by this work.

## Verified source

LB uses current cohort records in `user_tags`. On September22, read-only Lovable inspection confirmed active ShortScout project `83abe010-6650-45ff-af5b-308a849d3979` / Supabase `xejuximbbpnzqylukrsn`: `profiles.user_level` is protected by `enforce_profile_level_guard` on INSERT/UPDATE (ordinary users forced to free at insert and denied membership changes). Allowed values are free/monthly/annual/lifetime/mastermind; updated_at trigger present. This resolves the earlier source-inspection blocker. Existing `chat-auth-bridge` requires an individual user's session and cannot serve this integration.

## Implemented Longboard behavior

`chat_member_membership_sources(uuid[])` is an additive, service-role-only, security-invoker RPC with an empty search path and maximum200 input IDs. It resolves current LB tags and the SS subject from an existing verified identity or a nonrevoked membership bridge, preserving source ownership checks and direct-identity precedence. It reads no email or user metadata and creates no links. Login timestamps and cached login tier are not consulted for display mapping. Existing authorization functions, session freshness, account ownership and the prior badge RPC are unchanged.

Authorized room, thread and DM readers already call `withMessageMemberships`; this now uses the new mapping and signed current SS source. The result is labels only, never a subject exposed to the browser. Paid monthly/annual/lifetime/mastermind all produce SS badges, independently of LB; room eligibility remains its existing separate policy. Bots and missing/legacy identities remain unbadged. Remote failure hides SS while preserving independently verified LB.

`chatMembershipExport.ts` uses the fixed HTTPS producer, with redirects disabled and a5-second timeout. The cache is **per server process**, bounded to5000 subjects; it is not shared across workers. Successful paid/free/deleted results expire60seconds from request start. Each subject has only one refresh in flight within that process; overlapping readers share it, so a delayed response cannot overwrite a newer result. Responses arriving after60seconds are discarded. Expired positive results are never served on failure; a5-second negative retry cooldown limits outage traffic. Key rotation clears cached records and prevents old in-flight responses populating a new-key cache.

First signed read lazily backfills only already verified subjects; no login snapshot is seeded as current membership. No durable cache, new scheduler or database membership writes are required. A release smoke/backfill can request exactly the current verified subject set through the same bounded protocol without associating new users.

Remote membership changes propagate at the next read after cache expiration. Current healthy room history reads every60seconds and DM reads every10seconds, so an active room can take roughly120seconds (cache plus next read), a DM roughly70seconds. Inactive/background panes refresh on foreground. These are polling bounds under healthy services, not instantaneous updates or guarantees during network failures. Local bridge revocation affects the next mapping read without waiting on remote cache expiration.

## Producer wire contract v1

Fixed POST `https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export`; JSON UTF-8 request `{ "version":1, "subjects":["canonical-lowercase-uuid"] }`. Maximum200 unique valid UUIDs,32KiB request. Separate server-only `CHAT_MEMBERSHIP_EXPORT_KEY`, at least32 UTF-8 bytes of cryptographically random secret material; never reuse a login/session/shared health key. No user JWT is sent or accepted as this credential.

Request headers:

- `x-chat-membership-timestamp`: integer Unix seconds (10 decimal digits).
- `x-chat-membership-nonce`:16 random bytes encoded as32 lowercase hex characters.
- `x-chat-membership-signature`: lowercase hex HMAC-SHA256 over `request\n<TIMESTAMP>\n<NONCE>\n<EXACT_RAW_REQUEST_BODY>`.

Producer validates the signature in constant time, clock skew within60seconds, body/batch bounds and exact shape; queries current protected membership by subject, never email. This is a read-only bounded export, not a login or entitlement endpoint. A replay within the timestamp window can only repeat that read; the consumer accepts a response only for its outstanding random nonce and exact request digest.

A successful200 response is exact raw UTF-8 JSON:

```json
{"version":1,"nonce":"request nonce","requestDigest":"sha256 hex of exact raw request body","records":[{"subject":"requested uuid","state":"update","level":"mastermind"}]}
```

Exactly one record for every requested subject; no extras/duplicates. `update` requires monthly/annual/lifetime/mastermind; `revoke` requires free; `delete` requires null and means missing profile or missing Auth user. Query failure returns503 and must not masquerade as deletion. Responses may be in any record order.

Response header `x-chat-membership-timestamp` is the producer's current Unix seconds. Header `x-chat-membership-signature` is HMAC-SHA256 over `response\n<RESPONSE_TIMESTAMP>\n<REQUEST_NONCE>\n<EXACT_RAW_RESPONSE_BODY>`. Maximum64KiB response; `Cache-Control: no-store`. Consumer checks signature, clock skew, version, nonce, request digest and every record before caching any member in the batch. Source revisions are omitted because this is a request-bound pull snapshot with per-subject single-flight and request-start expiry, not an event stream.

ShortScout implementation belongs in a separate `supabase/functions/chat-membership-export/index.ts` and config entry, plus its service-only source query. Existing chat-auth-bridge stays unchanged. Producer deployment and scoped secret provisioning are separate rollout steps; neither occurred here.

## Local verification

Synthetic protocol tests cover signature/envelope/bounds, duplicate/missing/unrequested records, stale and long-running requests, redirects/failure, removal/deletion/recovery, batching and concurrent cache reads. SQL tests cover old/direct/bridged identity mapping, bridge revocation, same-email isolation, LB tag removal, source ownership, function grants and unchanged authorization freshness. Existing bridge authorization/history tests remain intact.

Actual DirectInbox test covers dark/light320/390/768/1440 widths with a30-day-old SS login identity and fresh signed paid response. It checks simultaneous LB+SS, adjacency, uppercase names and preserved published blue/white4px rectangular bubbles. The legacy synthetic adapter stubs only unrelated opening-anchor requests; actual inbox/membership reads execute against local PGlite and the signed source fixture. `chat-membership-records-browser.mjs` verifies remote membership revocation reaches active DM without a login or message edit, and room/thread/exact-ID old DM reads agree.

Run `node scripts/tests/chat-membership-alignment-fixture.mjs`, then Next on3335 with synthetic Supabase URL `http://127.0.0.1:54535`, test-anon/test-service-role keys and `CHAT_MEMBERSHIP_EXPORT_KEY=synthetic-test-key-never-a-production-secret`. Set `NODE_OPTIONS='--import ./scripts/tests/chat-membership-export-preload.mjs'` **only in the test process**: this checked-in test adapter redirects the fixed export transport to the local signed fixture; production has no endpoint override. Run the alignment and records browser scripts separately. Puppeteer/Chromium is used because agent-browser is unavailable.

The release plan hashes the new backward-compatible function migration. It must not be registered until producer readiness, exact implementation review and coordinated rollout requirements are satisfied. Test signing text is synthetic and is never suitable as a production secret.

Cross-repository verification: `node --import tsx scripts/tests/chat-membership-contract.mjs` directly imports the actual producer handler from sibling `shortscout-membership-export`; only authoritative source rows and the clock/transport are stubbed. It verifies real WebCrypto/Node HMAC and raw-body digest interoperability, paid/free/delete refresh without member login, failure/recovery, stale producer and wrong-key rejection. Run this with that producer checkout available; it is a coordinated integration check, not an application runtime dependency.

Validation completed locally:771 unit tests across98 files, source-mapping SQL, existing SS bridge preservation/authorization SQL, responsive actual DM UI, live synthetic revocation propagation, cross-repository producer/consumer contract, TypeScript and touched-file ESLint all pass. Production Next build passes with existing unrelated lint/Browserslist warnings (sandboxed build initially gave a generic worker/webpack failure; the standard unsandboxed local build completed). No remote migration, secret, endpoint deployment, PR or release registration was performed.
