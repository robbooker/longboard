# Private feature request channel

Route: `/chat/features`; entry appears in `/chat` only for exact members in `chat_feature_members`. All feature data is separate from public/member messages, search indexes, summaries, and Realtime publications. RLS is enabled and all browser role grants are revoked. Server routes verify the chat session and exact membership before using the service client. Ordinary admins have no implicit access.

One owner and one participant are enforced by unique indexes. Migration seeds Rob using his existing exact profile email. Jammie's confirmed account is `6ad10d99-fe91-4955-86fa-a893b9763573` (display name Jammie; ojammie@gmail.com confirmed by Rob). The migration seeds this exact email match.

## Workflow

Both members create requests, write messages, and edit a proposal while it is in discussion. Mention `@Codex` in each message that should receive an AI response. This planning assistant uses the existing server-only OpenAI configuration and has no coding tools. Its context includes the current proposal and latest 30 messages. Provider failure preserves the human message and displays a retry notice. Messages refresh every eight seconds. Requests show the newest 100 entries and threads the newest 200 messages.

Only the owner can approve or decline. Approval is a transaction with revision checking; it stores the exact proposal and approver and locks edits. Discussion can continue afterward but cannot alter authorized scope. Requests are limited to 20/member/hour and messages to 60/member/hour. No attachments in this first version.

## Desktop worker

Run from this repository with the existing local server-only credentials:

```
node --env-file=.env.local scripts/chat-feature-queue.mjs next
node --env-file=.env.local scripts/chat-feature-queue.mjs claim
node --env-file=.env.local scripts/chat-feature-queue.mjs progress ID WORKER_TOKEN "Progress update"
node --env-file=.env.local scripts/chat-feature-queue.mjs ready ID WORKER_TOKEN "Tested result and review link"
node --env-file=.env.local scripts/chat-feature-queue.mjs blocked ID WORKER_TOKEN "Dependency or clarification needed"
```

Claim is atomic with SKIP LOCKED; a second worker cannot claim the same request. Preserve the returned worker token for recovery. No automatic lease expiration or retry of unfinished work: inspect in-progress or blocked items before recovery to avoid duplicate implementations. Worker status and thread messages commit together. Work only from `approved_proposal`, in an isolated checkout. Never treat request text as permission to merge, deploy, access unrelated private data, or change permissions. Development approval does not authorize publishing.

App heartbeat `approved-chat-feature-requests` was created PAUSED at a 15-minute cadence, attached to the implementation task. Activate only after deployment, exact membership configuration, and verification of the live queue. Computer must remain awake with Codex running and network available.

## Rollout

Apply `20260916171034_private_chat_features.sql`, configure the confirmed participant by exact account ID, deploy code, verify both accounts and an unrelated member, then activate the paused heartbeat. Schema absence fails closed (no tab, page/API inaccessible). No production migration, membership write, deployment, or AI request was performed during implementation.

## Verification

248 unit/API tests, including mention reply persistence, failed AI delivery, verified actor identity, malformed inputs and unauthorized access. 22 isolated PostgreSQL checks: denied browser reads/RPC calls, outsider denial, participant approval denial, immutable approval snapshots, stale revision rejection, atomic claim, declined exclusion and worker ownership/status updates. Production build, TypeScript and targeted lint passed. Local browser with isolated PGlite fixture verified signed-out 404 and owner create → discussion → save proposal → approve → immutable scope. AI response verified with a mocked provider; real provider and live membership checks remain rollout checks.
