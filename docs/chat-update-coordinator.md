# S01 — coordinated chat updates

Request: `d9d1efed-5da7-4999-a717-f5adacb46172`. Development approved directly by Rob in Codex on September 17, 2026. Merge/publish still requires the feature page's exact-head approval.

## Behavior

The chat shell owns one `ChatUpdateCoordinator` and one Postgres changes channel for room messages/reactions and private conversation updates. Presence stays separate. Existing realtime message/reaction deltas still update the visible room immediately; notification/count invalidations coalesce over 100ms.

Background reads share a 20ms batching window and the same in-flight response for identical resource URLs. `POST /api/chat/updates` is a read-only, same-origin, authenticated batch, bounded to eight allowlisted reads. It resolves the chat identity once and delegates to the **same** readers as the existing GET routes. Room entitlement checks, verified DM participant filters, private feature membership and no-store responses remain in those readers. No schema, grants, RLS policies or production secrets change.

- Healthy realtime: metadata and an open thread/DM reconcile on aligned ten-second boundaries. Room history reconciles once per minute and on reconnect/foreground; ordinary message events apply directly rather than refetching the whole history.
- Browser realtime cannot serve every identity/room. The server derives room realtime eligibility from the existing room policies. Cookie-only sessions, unsupported rooms and disconnected sockets keep a two-second fallback for relevant room/activity resources; inbox/status/features remain at ten seconds. The six-request target applies to healthy realtime, not this necessary fallback.
- Hidden/offline pages start no background reads. Visibility/online/realtime recovery reconciles active resources. A room covered by a DM stops its history and reply-count watchers; global alerts continue. Already-running requests can finish.
- A resource cannot overlap its own scheduled refresh; invalidation during a running request schedules one follow-up. Slow requests do not cause periodic catch-up loops. Transport requests have a 15-second deadline and are aborted on shell teardown.
- The coordinator is scoped to the mounted shell, not a module-global private cache. Logout/account change disposes work. A revoked authoritative session redirects to chat login on its next batch.
- Reconciliation preserves local pending messages and rejects a room snapshot if a local/realtime mutation happened while it loaded. The history reader returns up to 80 rows, matching the existing realtime room window instead of repeatedly shrinking an 80-row conversation to 60. Full versioned delta/history reconciliation remains R01.
- Standalone feature-page notifications retain their existing independent behavior; this change consolidates the chat shell's bell. The Codex ticket pickup schedule is unchanged.

## Evidence

In the isolated Chromium browser, an authenticated SOCIAL room with healthy mock realtime made **six consolidated refresh requests over 60 seconds**, with zero legacy polling GETs. Intervals were 9,999–10,001ms. See [aggregate measurement](evidence/chat-s01-idle.json). Startup, user mutations, incoming events, presence/keepalives and disconnected/server-cookie fallback are outside the idle budget.

This demonstrates request coordination, not a production end-to-end latency percentage. The original review's approximately 62 requests/minute was a code-derived timer estimate. Production latency instrumentation remains M01.

Browser checks used synthetic accounts/data only:

- Cookie-only account loaded SOCIAL, opened a thread, sent a reply and saw the root reply count update.
- Longboard account received a realtime room message, accepted a DM request, sent a DM and saw sidebar/bell unread counts clear.
- A simulated socket disconnect followed by a new mention recovered; while a DM covered the room, the room badge/bell still updated. Returning to the room showed the missed message.
- Final realtime path and browser console checks passed after the final coordinator changes.
- Desktop was verified at 1280 CSS pixels. The browser viewport override did not apply to this test tab, so no new mobile-layout verification is claimed. No CSS/layout changes belong to S01.

## Automated verification

- 388 Vitest tests across 61 files pass, including 13 coordinator tests and 9 batch-route tests.
- New coverage: request budget, deduplication, event bursts, slow requests, hidden/offline behavior, unsubscribe/DM coverage, reconnects, cookie-only fallback, history cadence, teardown/restart, transport recovery, session revocation, bounded resources, private feature exclusion, room denial and DM participant filters.
- TypeScript and targeted ESLint pass. Production build passes; existing unrelated lint warnings remain.
- The unchanged published checkout initially had 33 failing legacy assertions. Fixtures omitted the Boardroom entitlement or expected superseded feature APIs/announcement reaction behavior. Test-only updates restore coverage of the current contracts. They do not relax access rules; new batch tests explicitly deny a Longboard account without Boardroom entitlement.

Run:

```sh
npm test
npx tsc --noEmit
npm run build
```

Local synthetic browser fixture (never point these commands at production):

```sh
node scripts/tests/chat-updates-fixture.mjs
# In another terminal:
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54440 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon SUPABASE_SERVICE_ROLE_KEY=test-service-role NEXT_PUBLIC_SITE_URL=http://localhost:3240 npm run dev -- --hostname 127.0.0.1 --port 3241
# In a third terminal:
node scripts/tests/chat-updates-proxy.mjs
```

Open `http://localhost:3240/login?next=%2Fchat%3Froom%3Dsocial`; the synthetic account is `alice@example.test`, password `demo-only`. The proxy records method/path/time, never request bodies, in `/tmp/chat-s01-requests.json`. Fixture-only `/test/message?body=...` inserts a synthetic room message; `/test/disconnect` closes mock sockets. The mock realtime adapter tests protocol/recovery; it does not replace production RLS/participant checks. Stop all three processes after testing.

## Release

No migration or environment changes. Register the tested PR/head with the existing feature-release workflow. Publish only after Rob approves that exact version. Verify production login, room/thread/DM delivery, unread clearing and fallback behavior; mark the feature complete only after that verification.
