# S02 — authorized chat bootstrap

Implemented against published S01 (`9aaa76cf1995380764ce8d29b9c5e638ee1a9b3d`).

## Behavior

- `/chat` resolves the authenticated identity once, checks room access, then loads member identity, room state, history/reactions/counts and feature membership. Independent reads overlap; the result is passed directly to the client component without a loopback HTTP call.
- The initial HTML includes messages and the member composer. The normal page no longer calls `/api/chat/member` after hydration. The client-only fallback remains for other component callers.
- Shared history/count readers retain their room checks. The existing S01 coordinator still reconciles after mount/subscription to close the server-render-to-realtime gap. This intentionally retains reconciliation reads; it does not treat the initial snapshot as permanently fresh.
- Each auth call performs fresh identity/entitlement checks. Account, linked-provider and tag reads run concurrently after the Longboard identity is verified. Existing accounts are read, not upserted. First visits retain the conflict-safe insert with `ignoreDuplicates`, never overwriting an account link.
- Cookie-only sessions check expiry/revocation before account reads, still require fresh provider verification, and never inherit admin privileges. Linked profile/tag reads overlap.
- Admin requests reuse their already verified identity but still check the current admin role and owner table. Non-admin browsers no longer issue the known-useless admin request.
- No global auth cache, entitlement TTL, localStorage history, RLS change, migration, or environment setting is added. The page is explicitly dynamic. Bootstrap loading errors render an unavailable message rather than partial private state.
- The client lifetime is keyed by account and room. The first browser auth event is compared with the server account, and later logout/account changes clear room data before reloading. Cookie-only expiry is detected by subsequent authorized updates.
- Server timestamps initially use deterministic ISO text; after hydration they render in the viewer's local timezone. This avoids server/browser timezone hydration errors.

## Validation

- 407 tests across 64 files passed. New coverage includes independent lookup overlap; fresh permission removal; first-account provisioning and failures; cookie revocation/provider expiry; account separation; forbidden-room bootstrap; first-time member/name setup; bootstrap errors; owner-role/ownership preservation.
- TypeScript, targeted ESLint, diff check and production build passed. `/chat` reports 30.5 kB route / 209 kB First Load JS (S01: 30.2 / 208 kB). Bootstrap transfers bounded message data in initial HTML/RSC instead of waiting for a client member request.
- Synthetic browser: initial messages available with JavaScript disabled; member composer accepts a draft after hydration; no `/api/chat/member` request; no browser page errors. Desktop 1280 px and mobile 390 px checked, including Chicago and Tokyo timezones. Cookie removal leads to login and removes private articles. No messages sent to production or test members.
- A controlled benchmark uses production builds, identical synthetic PGlite/auth data, 50 ms injected delay per service HTTP call, alternating versions and five measured runs each after an excluded warmup pair. Reports are under `docs/evidence/`.

| Room | S01 loaded chat (median) | S02 loaded chat (median) | S01 typed draft (median) | S02 typed draft (median) |
| --- | ---: | ---: | ---: | ---: |
| Social, 1 message | 945 ms | 483 ms | 1,010 ms | 551 ms |
| Main, 80 messages | 975 ms | 542 ms | 1,401 ms | 926 ms |

The full-room loaded-chat ranges were 939–987 ms before and 529–564 ms after. “Loaded” requires messages, an enabled composer and the post-hydration theme effect; “typed draft” additionally types 20 characters and verifies the counter updates. The latter includes browser automation overhead and repeated React renders, not only a single keypress latency. No drafts are sent. Traces show parallel account/provider/tag reads and zero existing-account writes in S02; the baseline repeats sequential reads/writes. The existing local fixture's single HTTP origin simulates services and is not a production topology.

These measurements are local experimental results, not production performance guarantees. Initial read failure now blocks the chat content with a retry message. Background notification/inbox requests remain, and there is still an intentional initial reconciliation. Server-side streaming, optimistic sends, field timings and broader layout changes belong to later recommendations.

## Reproduce

Use separate S01 and S02 worktrees. Never point the fixture or benchmark at production. Install dependencies, then build both with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54450`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon`, `SUPABASE_SERVICE_ROLE_KEY=test-service-role`, and their respective local `NEXT_PUBLIC_SITE_URL`.

1. Run `FIXTURE_LATENCY_MS=50 node scripts/tests/chat-bootstrap-fixture.mjs` from S02.
2. Run the S01 production server on `127.0.0.1:3252` and S02 on `127.0.0.1:3251`, with the same synthetic environment. Browser URLs use `localhost`.
3. Run `node scripts/tests/chat-bootstrap-browser.mjs` for the sparse Social room, and `BENCH_ROOM=main node scripts/tests/chat-bootstrap-browser.mjs` for the full room. Each run writes `/tmp/s02-browser-results.json`; preserve the first before the second overwrites it.
4. Run `node scripts/tests/chat-bootstrap-smoke.mjs` for cookie-only SSR/mobile/session expiration.

The scripts launch Chromium from `/usr/bin/chromium`. Trace records contain service paths, methods and timestamps, not cookies, credentials or message bodies. The synthetic fixture serializes SQL execution; its injected transport delay occurs before that queue so independent calls can overlap.

## Release

Ticket: `a95593a1-ae35-4cc0-b55b-3ca165ead5a7`. Register the actual draft PR and tested head, then wait for owner feature-page approval. No schema/environment rollout is needed. After deployment, check authorized room/thread/DM reads and the bootstrap page, then mark published with the real merge and deployment evidence.
