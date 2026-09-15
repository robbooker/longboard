# Member chat and message requests

`/chat` keeps its public guest room and adds private, account-linked messaging. Signed-in users choose a member name once. A valid guest token can link the existing guest identity; linking retires that token. Account sessions then determine the member identity on all devices. New public posts carry an opaque `member_id`; older guest posts are not retroactively presented as verified member posts. Member names are unique ignoring case; guest names do not receive a member badge.

## User flow

- Sign in from `/chat`, choose a member name, and return to the room.
- Tap another member's name to open the private request composer.
- The first message creates one request. No further messages may be sent until the recipient accepts.
- Recipients can accept, decline, block, or report. Declined pairs cannot create repeated requests; blocking stops new messages in both directions. Unblocking removes only the current member's block.
- The Inbox shows requests, conversations, and unread counts. A preference disables new requests without interrupting accepted conversations.
- Conversations load the most recent 50 messages and support earlier-history pagination.
- Reports are available to the existing chat owner in the Admin panel. That route exposes messages only for reported conversations. Private messages are not included in Buddy context or public chat summaries.

## Access and data

The migration adds `longboard_chat_members`, `longboard_chat_conversations`, `longboard_chat_direct_messages`, `longboard_chat_blocks`, and `longboard_chat_reports`, plus an optional `member_id` on public messages. Member-to-account mapping is readable only by the member and the trusted server. Guests retain public read access only to the existing public chat tables.

All private tables have RLS. A signed-in client can read only its member record, conversations it participates in, messages in those conversations, and its own block list. Clients have no direct write privileges and cannot execute the mutation or inbox RPCs. Routes use the verified session account, ignoring client-supplied account IDs. Conversation history uses the session-scoped Supabase client so RLS separately checks membership. Inbox summaries and writes use restricted service-role RPCs with server-derived account IDs.

RPCs are `SECURITY INVOKER`, with public/anonymous/authenticated execution revoked. Transactions and advisory locks serialize identity linking, sender rate checks, and changes to a pair's conversation. A unique unordered pair index prevents two simultaneous opposite requests from creating two conversations. Client-generated message IDs support safe retries. Read acknowledgements reference an actual displayed message and only advance the read sequence.

Limits: 2,000 characters per private message, 10 new requests per account per day, 60 private messages per account per ten minutes. The first request is included in these limits. Public chat limits remain unchanged.

## Files

- `components/chat/PublicChat.tsx`: member identity, sign-in entry, member-name actions.
- `components/chat/DirectInbox.tsx`: requests, conversations, blocking, reporting, unread counts, settings and history.
- `components/chat/ChatReportReview.tsx`: owner review of reports.
- `app/api/chat/member/route.ts`: session identity and account linking.
- `app/api/chat/inbox/route.ts`: authenticated inbox/history and validated mutations.
- `app/api/chat/reports/route.ts`: owner-only report inspection.
- `supabase/migrations/20260915115419_chat_member_direct_messages.sql`: tables, grants, policies, transaction functions and Realtime publication.

## Verification

Run `npm test`, `npm run test:chat-db`, `npx tsc --noEmit`, and the production build with the intended environment.

The database suite uses pinned PGlite (embedded PostgreSQL) with real roles, RLS, functions and constraints. It requires no credentials and never connects to production. Checks cover unauthorized reads/writes/RPCs, account identity, request lifecycle, block direction, settings, unread receipts, retries, name collisions and rate limits. It does not simulate multiple independent PostgreSQL connections contending for locks.

Browser verification used fictional accounts with the actual Next.js routes and an isolated HTTP test adapter backed by PostgreSQL. Verified guest entry, cookie login and return to chat, restored member identity, name-to-request navigation, recipient inbox, acceptance, persisted replies, blocking and phone-width layout. The adapter does not implement Supabase WebSockets; production Realtime delivery remains to be verified. The UI also refreshes on foregrounding and polls every 15 seconds to recover missed updates.

## Publishing

The member/DM migration was applied to the Longboard Supabase project on September 15, 2026, with registry version `20260915115419`. For other environments, apply the migration before deploying the app. This is additive for the existing public room. The normal production build needs the existing Supabase public URL, public key, and server-only service-role key. No new external service is required. Do not publish a prebuilt bundle from the isolated fixture environment; rebuild with the deployment's normal environment variables.

After publishing, verify with two authorized test accounts: link names, send a request, accept, reply, check realtime and unread behavior, block, and confirm a third account cannot read the conversation. Test owner report review separately. Rollback should restore the prior app build while retaining the new tables and private data; do not drop message tables to roll back the interface.
