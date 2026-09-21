# Gainers broadcast channel

The GAINERS room is available to the existing SOCIAL entitlement union: Longboard members, verified paid ShortScout members, and Longboard chat admins. This does not widen LB or SS room access or change website login. Every member, including admins, sees a broadcast-only channel with reactions and no composer or reply buttons. Ordinary send/edit/delete/upload endpoints deny writes; SQL denies forged source messages, replies (including cross-room), and updates.

## Producer contract

`POST /api/chat/gainers/ingest` with `Content-Type: application/json` and `Authorization: Bearer <dedicated producer token>`:

```json
{"sourceChannelId":"-1001234567890","sourceMessageId":123456,"postedAt":"2026-09-21T19:00:00.000Z","body":"Original Telegram text or caption"}
```

The sample channel ID is illustrative, not the production source. Configure the exact TDLib channel ID for **Callz Stocks Gainers Alert** after verifying the actual listener. Message IDs must be positive JavaScript safe integers. Body is original text/caption, max4096 Unicode characters; content above this bound must be surfaced for review, not silently truncated. No attachments or historical backfill in this first version.

Server-only configuration (never NEXT_PUBLIC):

- `CHAT_GAINERS_INGEST_TOKEN`: independent cryptographically random secret, at least32 characters; no Supabase/admin credential is shared with the relay.
- `CHAT_GAINERS_TELEGRAM_CHANNEL_ID`: exact signed numeric channel ID string.
- `CHAT_GAINERS_START_AT`: immutable explicit UTC rollout start. Messages before it are rejected; missing configuration fails closed.

Successful200: `{messageId, duplicate}`. Source channel and source message ID form the idempotency key. Concurrent/repeated identical deliveries return the same chat ID. Conflicting content/timestamp for an existing key returns409. New messages only: Telegram edits do not silently mutate published alerts.

The source ledger and chat insert commit in one database transaction. Paused rooms or database failure roll back both.503/network failures can be retried. The caller must durably save the original payload, retry with backoff, retain failed records, surface401/400/409/413/415, and not block later deliveries behind a terminal failure. A200 is acknowledged only after durable insert or verified duplicate.

## Rollout and verification

Migration and app publication use the existing dedicated release service after owner approval of the exact PR/head. Production source configuration and Mac Mini installation are separate rollout steps. Keep the current Slack destinations and TraderRadio behavior intact. Configure a fixed rollout start, ingest from raw Telegram events, and recover missed new events after restart without importing earlier history or synthetic TraderRadio backfill. Verify one actual subsequent source event appears exactly once before declaring the relay live.

No announcement fanout, mention alerts, push jobs, or AI embedding jobs are created for these source rows. The normal room unread count is available. The installed application receives the same room automatically through its shared codebase.

Local validation uses synthetic data only:

- `npm test`: parser/auth/failure and ordinary member/admin writer denial, existing regression suite.
- `node scripts/tests/chat-gainers-database.mjs`: actual isolated PostgreSQL migration, membership/expiry/RLS, dedup/conflict, pause rollback/retry, forged-source/reply/upload denial, no fanout.
- `node scripts/tests/chat-gainers-browser.mjs`: actual PublicChat components/CSS in Chromium at320/390/1440 for members and admins; synthetic auth/HTTP, no production calls. Checks long-message rendering, absent composer/reply, read-only notice, horizontal overflow and runtime errors. This does not verify actual Telegram delivery.

## Local implementation verification (September21,2026)

Integrated on published `ec9a676` (RB app branding).736 unit tests across95files,34 isolated SQL suites,71 release-service tests, TypeScript, targeted lint and production build pass. The browser harness passes320/390/1440 for both member/admin layouts; screenshots were inspected. Live Telegram→production verification remains a rollout requirement. LB sessions use the existing Realtime transport for Gainers; cookie-only SS sessions retain the existing authenticated polling transport.

Durable relay and existing-listener integration are included under `scripts/gainers`; see `chat-gainers-relay.md`. All23 relay/adapter/glue cases pass, including optional checks against the real listener snapshot. The existing listener has unrelated local edits; rollout must back it up and apply the reviewed insertion without resetting the checkout. No Mac Mini files or live configuration have been changed.
