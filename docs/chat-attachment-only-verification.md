# Attachment-only sending verification

Ticket: `f69285df-6bf7-4a0c-a404-f201d28ce908` — Sending Attachments.
Published baseline: `dbb4af397e49f25399b9ba70f8f6d589e2c90b76`.

The reported behavior was a prompt for typed text after selecting a file or
pasting a screenshot. That failure was not reproduced on the published source.
The existing implementation already sends ready attachments with an empty body.
This change adds regression evidence only: no application, API, SQL, permission,
read-marker, or notification behavior changes. No migration is needed.

Release outcome: **existing attachment-only behavior verified; original
typed-message prompt not reproduced; no runtime fix or schema change.** The
ticket's release manifest has an empty migration list and the standard login
availability probe.

## Existing contract

- Room and reply sends permit an empty trimmed body when ready attachment IDs
  exist. `MentionTextarea` adds no `required` or `minLength` constraint. The room
  API explicitly permits `body: ''` with nonempty attachment IDs.
- The DM textarea uses `required={!uploads.ids.length}`. Accepted conversations
  support attachment-only sends; introductory DM requests do not support files.
- Room and DM database constraints permit empty bodies with attachments. Binding
  triggers still require scanned, ready files owned by the sender in the exact
  room or conversation. Failed multi-file binding rolls back atomically.
- Empty text without files is rejected. Uploading, scanning, or failed drafts
  keep sending disabled. Exact client-ID retries do not create another message.
- Quad uses the same room and DM composers and authorization paths.

## Verification

`scripts/tests/chat-attachment-only-database.mjs` loads the actual chat migration
chain through the published ShortScout authorization migration and passes 69
assertions. It covers LB, SOCIAL, SS, replies, accepted DMs, retained multiline
text, scan states, ownership, scope, duplicate attachment IDs, atomic rollback,
same/conflicting retries, empty rejection, stable retry read markers, and
service-only execution. Data and storage metadata are synthetic and local.

`scripts/tests/chat-attachment-only-browser.mjs` runs the actual Next application
against the existing current-schema PGlite/auth/storage adapter and a synthetic
scanner response. It verifies 19 sends, persisted empty bodies, scanned file
binding, selected-file/button and pasted-image/Enter flows, text-plus-attachment
formatting, reload, exact downloaded file bytes, loaded thumbnails, same-client
retries, failed-send draft preservation, mixed
ready/failed upload blocking, rooms/replies/DMs/Quad, and strict SS denial after a
source downgrade. Native validity assertions confirm that ready attachments do
not require text. Chromium covers 390px mobile room/reply/DM layouts and desktop
Quad; physical Safari/iOS clipboard behavior is not established by this test.

The unchanged full unit suite passes 870 tests across 107 files. Existing room
attachment and 28-assertion DM media database suites, TypeScript, focused ESLint,
71 release-service tests, migration-free manifest validation, and the production
build also pass. The build retains existing unrelated lint warnings. An
independent reviewer reproduced all 69 current-schema database assertions and
the 19-send browser matrix without a code finding.

## Reproduction

Use only synthetic local environment values. Start the existing
`chat-shortscout-authorization-fixture.mjs` with `node --import tsx`,
`CHAT_FIXTURE_PORT=54556`, and `CHAT_APP_PORT=3356`. Its default signed source
handler comes from the sibling `shortscout-chat-auth-renewal` checkout; an explicit
`CHAT_AUTH_SOURCE_HANDLER` may point to that same tested handler elsewhere.

Start Next on port 3356 with:

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54556 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon \
SUPABASE_SERVICE_ROLE_KEY=test-service-role \
CHAT_MEMBERSHIP_EXPORT_KEY=synthetic-test-key-never-a-production-secret \
CHAT_TEST_SCANNER=isolated-fixture \
TRANSLOADIT_KEY=synthetic-key TRANSLOADIT_SECRET=synthetic-secret \
NODE_OPTIONS='--import ./scripts/tests/chat-attachment-only-preload.mjs' \
npm run dev -- --port 3356
```

Then run the two attachment-only scripts with Node. The preload is exclusively
for this local verification and must never be enabled in a deployment. Sends
respect the existing 1.5-second room rate limit. Multiline entry uses Shift+Enter;
plain Enter intentionally sends. Browser controls are checked for hydration
before file selection rather than relying on a perpetually polling page becoming
network-idle.

## Remaining report gap

The original report did not identify the room, device, browser, or exact prompt.
No claim is made that an unknown device-specific or stale-client failure was
fixed. An unauthenticated read of the deployed `/chat` route redirects to
`/chat/login`, so it did not expose the authenticated composer bundle for direct
comparison. No production messages, credentials, migrations, or settings were
accessed or changed during this verification.
