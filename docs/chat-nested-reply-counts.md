# Reply in Reply Count

Ticket `33c2d5fb-81d9-4da3-a351-7ef7a25fa9d0`, approved revision 2. Initial published base: `6fae6cb054a94961aa18f6afbf53522400320a56`.

Every confirmed reply now uses the same reply button as the room feed: **↳ Reply**, **↳ 1 reply**, or **↳ N replies**, with the existing counted-button emphasis. Opening the button still selects that exact message as the next thread original. The count describes direct visible children, at every nesting depth. A deleted placeholder remains a child while its descendants keep it visible; removed messages do not count. The current `chat_thread_counts` SQL already provides those semantics and is unchanged.

The shared count hook canonicalizes IDs by deduplicating and sorting, then requests batches of at most 80 through the existing update coordinator. This covers both a thread's 100 reply rows and a room feed's 81 rows when it retains an old opening/pinned anchor. Independent batches run concurrently and publish one complete result only after all succeed. A failed batch cannot mix partial numbers into the previous complete snapshot. The hook does not guess increments, so retried sends and repeated delivery cannot inflate counts.

Results are scoped by account, member, room, thread and exact requested IDs. A scope change immediately hides the previous snapshot and disposes its watcher; late completions cannot restore it. An opaque per-hook generation in the request query also prevents the coordinator from deduplicating a new scope into an old in-flight read, including A→B→A navigation. The token contains no account ID and carries no authorization meaning; the existing reader still derives and validates access on the server. It stays stable within the same scope. Separate mounted count hooks intentionally do not share identical count URLs; they still share the coordinator's bounded HTTP batching and reconciliation cadence. No timer, poller, API contract or schema is added.

The shared hook/helper, narrow PublicChat identity argument and their tests were isolated in prerequisite commit `573f764e683665e4fa47ee63f215d9428800e80d` for Pins to integrate first. The nested UI changes only its hook call and button label/attribute. Pin controls, sends, idempotency keys, deletion handlers, navigation, drafts, scroll behavior and read/activity markers retain their existing implementation.

## Verification

Pre-integration checks on the local branch:

- 906 unit tests in 111 files; TypeScript passes; ESLint has zero errors and ten existing unrelated warnings; all 71 release-service regression tests pass.
- 114 current-schema database assertions cover four direct levels, zero/one/many counts, 100 targets, duplicate-send retries, retained tombstones followed by ancestor removal, room isolation and service-only count grants.
- The actual React hook and actual update coordinator pass a controlled Chromium test for 100/81 IDs, atomic failure, queued invalidation follow-up, stable sorted IDs, account/member/room/thread/ID changes, stale A→B→A responses and watcher cleanup.
- The local Next app browser matrix passes 1440px desktop, 320/390px mobile and Quad: all 100 reply IDs including sorted positions 79/80/81/100; matching room/nested label styling; four-level exact open/back navigation; root direct counts unchanged by a grandchild; lost successful send acknowledgement followed by the same-client retry and one stored row; preserved thread draft; realtime add/delete; tombstone retention and pruning; no horizontal overflow; all observed count requests at most 80 IDs and successful; zero runtime errors.

The fixture uses actual message/auth/count/send/delete SQL and routes with synthetic accounts only, on ports 3360/54560. It includes the published deletion, notification, strict ShortScout authorization, pinned unread and current-name migrations relevant to chat. The local source preload redirects only the synthetic ShortScout membership transport. The 100-row history is dated outside the unchanged ten-minute send limit. PGlite tests are sequential, and responsive Chromium is not a physical-device test.

Run `scripts/tests/chat-nested-reply-counts-database.mjs`, `scripts/tests/chat-reply-counts-hook-browser.mjs`, and `scripts/tests/chat-nested-reply-counts-browser.mjs`. Start the synthetic server with `node --import tsx scripts/tests/chat-nested-reply-counts-fixture.mjs`; build/start Next with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54560`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon`, `SUPABASE_SERVICE_ROLE_KEY=test-service-role`, `NEXT_PUBLIC_SITE_URL=http://localhost:3360`, `CHAT_MEMBERSHIP_EXPORT_KEY=synthetic-test-key-never-a-production-secret`, and `NODE_OPTIONS='--import ./scripts/tests/chat-nested-reply-counts-preload.mjs --dns-result-order=ipv4first'`. Logs and inspected screenshots use `/tmp/chat-nested-counts-*`.

Published Pins integration, production-build browser validation and the final full checks remain required before coordinator registration. This migration-free release uses the dedicated release service; this worker does not push, register, approve or publish.
