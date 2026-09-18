# Starting new DM conversations

Request `d570958d-efd9-4ecc-a3b7-6b9968218ecf`.

“Start New DM” appears above the sidebar’s conversation list on desktop and in mobile navigation. The dialog searches registered chat names, including members who have never posted. Search accepts 2–28 characters and returns at most 20 eligible names in stable alphabetical order. Selecting a name opens the existing request/conversation workflow; it does not send a request or provision an identity.

The picker uses the existing `setDmTarget` integration. Existing pending and accepted conversations remain available even if the other member later opts out of new requests. Either-direction blocks, declined conversations, new-request opt-outs, self, and accounts without current chat access are excluded. Actual sends continue to enforce the existing request acceptance and blocking rules if eligibility changes after a search.

The authenticated `/api/chat/dm-members` endpoint derives the account from `requireChatUser`. The SQL function derives its member identity server-side and filters eligibility before its fixed limit. Responses explicitly project only opaque member IDs and display names, with private/no-store caching; no emails, account IDs, block state, or opt-out flags are returned. Literal substring matching uses `strpos`, so underscores and percent signs cannot expand into wildcard searches. Browser roles cannot execute the directory function directly.

## Verification

- `node scripts/tests/chat-dm-directory-database.mjs`: 27 assertions for no-history members, wrong/unregistered caller, query bounds, both block directions, opt-out/existing relationships, declined conversations, literal matching, stable order, post-filter limit, read-only behavior, and role grants.
- `npx vitest run lib/__tests__/chatDmDirectoryRoute.test.ts`: 18 assertions for authentication, server-derived caller, response projection, normalization/bounds, duplicate query rejection, and safe errors.
- TypeScript, targeted ESLint, diff checks and the production build pass (only existing unrelated lint warnings).
- `node scripts/tests/chat-dm-directory-browser.mjs`: desktop 1440/mobile 390; discovers a zero-post member, verifies Escape/focus, ArrowDown/Enter selection, no automatic sends, one explicit request, existing request routing, mobile navigation closure/composer focus, empty/error/retry handling, and no horizontal overflow or page errors.
- Browser coverage uses Chromium with desktop/mobile viewport emulation; physical-device Safari was not tested.
- Screenshots: `/tmp/start-dm-picker-desktop.png`, `/tmp/start-dm-request-desktop.png`, `/tmp/start-dm-picker-mobile.png`, `/tmp/start-dm-conversation-mobile.png`.

For local reproduction, start `node scripts/tests/chat-dm-directory-fixture.mjs`, then:

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54462 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon SUPABASE_SERVICE_ROLE_KEY=test-service-role npm run dev -- --port 3262
node scripts/tests/chat-dm-directory-browser.mjs
```

All fixture users and data are synthetic. The fixture extends the shared test server without editing it and registers Zoe without any public messages or DMs.

## Rollout

Apply `20260918115352_chat_dm_directory.sql` before deploying the application change. The new function is `SECURITY INVOKER` with an empty search path and service-role-only EXECUTE; no new table or public directory grants are added. No production migration, release, or deployment was performed by this worker. DirectInbox remains unchanged for the parallel focus/send task.
