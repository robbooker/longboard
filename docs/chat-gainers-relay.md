# Gainers relay integration contract

Prepared helper only; no change has been made to the Mac Mini, its dirty listener,
Telegram authorization/session, TraderRadio delivery, or either Slack destination.

Attach this helper to the **existing authenticated TDLib client**. Never open a
second session, duplicate a listener, or repurpose TraderRadio filtering/toggles.
The helper needs the unfiltered raw `updateNewMessage` stream, before TraderRadio's
stock parsing and source enable/disable logic. It accepts TDLib `@type` or `_` types.

Configuration must be supplied by the installation process:

- `sourceChannelId`: confirmed signed numeric Telegram chat ID as a string (derive
  from the existing Callz Stocks Gainers Alert channel; do not guess an ID).
- `activationAt`: one exact UTC ISO timestamp, chosen and saved at activation. Do
  not recompute it on process restart. Only genuine messages at/after this time
  are eligible. No synthetic history or test alerts go to production.
- `destination`: approved HTTPS URL with exact `/api/chat/gainers/ingest` pathname.
- `token`: `CHAT_GAINERS_INGEST_TOKEN` from private process configuration. It must
  never appear in source control, report events, state, logs, or command arguments.
- `stateFile`: persistent private local disk path, outside a checkout and outside
  synced/public directories. One process owns this file; do not run two writers.

The state pins source, activation, and destination. A config change refuses startup
rather than silently replaying or resetting. The JSON state contains alert text,
original timestamps, original message IDs, delivery outcomes and unsupported-media
records, but no token. New files are 0600; new directories 0700. Writes use fsync,
atomic rename, and directory fsync. Do not delete this state during deployment.

## Attachment outline

```js
const { attachGainers } = require('./gainers-adapter.cjs');
const gainers = await attachGainers({
  client: existingTdlibClient,
  config: gainersEnabled ? {
    stateFile, sourceChannelId, activationAt, destination,
    token: process.env.CHAT_GAINERS_INGEST_TOKEN
  } : undefined,
  report: event => operationalLog(event)
});
// In the existing shutdown hook:
await gainers.stop();
```

The supplied adapter attaches before initial recovery, schedules bounded recovery
retry, performs a five-minute repair sweep, responds to `ready` and TDLib
`updateConnectionState/connectionStateReady`, catches asynchronous callback failures,
and removes only its own listeners on shutdown. Missing optional config is a no-op.
Shutdown waits for queued callbacks, active recovery, and any in-flight delivery.
Recovery failures and state-write failures remain visible through report events;
report callback exceptions cannot interrupt update processing.

The listener's existing TDLib adapter uses `_` for requests, as emitted by this helper. Keep existing handlers.
Wire reconnect/recovery scheduling to the listener's actual lifecycle, verify with
its real adapter, and ensure an unsuccessful recovery remains visible and retries.
Do not launch async event callbacks without rejection handlers. Stop the timer on
shutdown and wait for outstanding live accepts to settle before exiting normally.

Recovery follows `getChatHistory` pages of 100 until empty or older than activation;
it does **not** stop on a short page or an arbitrary message count. A stalled cursor
fails visibly and keeps delivery paused. Each recovery scans back to activation,
not only a high watermark: a live event can advance a watermark ahead of a history
gap. The recorded watermark advances only with a durable accepted payload. No
truncation or retention pruning is implemented: size/recovery duration should be
monitored; future compaction must preserve deduplication and gap recovery.

Delivery is serial, ordered by original timestamp then ID among currently queued
messages. Catchup pauses further sends while history is loading. Already in-flight
HTTP requests cannot be unsent; late Telegram updates may therefore arrive after a
newer delivered alert. Each original payload is immutable across restarts/retries.
The receiving API must enforce unique source+message ID and return its existing
record for identical retries; HTTP 409 quarantines a conflicting original payload.

Requests use a 15-second abort timeout, disabled redirects, bounded exponential
backoff (up to five minutes), and Retry-After support. Network errors, 401, 403, 408, 425,
429 and server failures retry; other 4xx quarantine visibly and allow later alerts
to proceed. 401/403 emit authentication-failure and preserve the queue until credentials are
repaired; they do not quarantine legitimate alerts. Quarantines are retained for
operator investigation, never auto-deleted.
A durable-write failure pauses delivery pending history recovery; if the server
accepted but the acknowledgement write failed, replay uses the same original
payload so server deduplication handles the uncertainty.

Text messages and media captions are forwarded as plain text only. Unsupported
or empty media creates a durable rejected record and `unsupported` event. This
version does not upload Telegram media binaries, synthesize descriptions, or send
chat push notifications itself.

## Local verification

`node --test gainers-relay.test.cjs gainers-adapter.test.cjs`

Coverage: restart and immutable replay; HTTP retry and dedup; ordering; 409
quarantine with later delivery; 429 Retry-After; 605-message paginated catchup
racing a live update; disk-write failure and watermark; uncertain delivered ACK;
immutable config; caption and unsupported media; activation cutoff; cursor stall; credential repair; recovery failing during HTTP delivery; unchanged
unsupported replay suppression; adapter optional mode, listener order, reconnect,
retry, periodic repair, callback safety, and shutdown cleanup.

Before enabling production: parent reviews module, integrates with actual listener
API/lifecycle, verifies the new ingestion endpoint is deployed and approved, stores
private token, confirms exact source ID/activation timestamp, and performs a
supervised genuine-source delivery check. Leave TraderRadio and Slack intact.

## Prepared integration for the existing Mac Mini listener

`telegram-listener-gainers.patch` adds only ten lines after the existing
`--dump-messages` early return and before the existing `writeHistoryFeed` call.
The original listener snapshot is deliberately **not** included. The patch lazily
requires `./lib/gainers/gainers-listener-glue.cjs` only in `--watch` mode when
`CHAT_GAINERS_ENABLED=1`. Missing modules or invalid configuration disable only
Gainers with a sanitized operational message; existing TraderRadio work continues.

At approved rollout, install the three runtime CJS files (relay, adapter, listener
glue) into `lib/gainers/` adjacent to the listener. The patch targets `scripts/squawkbox-telegram-tdlib.mjs`. Back up the
current dirty listener and re-read it: `make-listener-patch.cjs SNAPSHOT` refuses
changed or duplicated anchors and generates an insertion-only patch, so unrelated
existing changes are preserved. Review the generated diff and run syntax checks;
never replace the dirty live file with a repository baseline.

Optional production configuration (no values supplied here):

- `CHAT_GAINERS_ENABLED=1`
- `CHAT_GAINERS_TELEGRAM_CHANNEL_ID`: exact resolved signed numeric ID
- `CHAT_GAINERS_STATE_FILE`: absolute persistent private outbox path
- `CHAT_GAINERS_START_AT`: fixed UTC ISO timestamp selected at activation
- `CHAT_GAINERS_INGEST_URL`: approved HTTPS endpoint URL
- `CHAT_GAINERS_INGEST_TOKEN`: private token, at least 32 characters

The glue checks the actual resolved `channel.id` against the expected ID and emits
an `attached` status containing only the channel ID/title. This status confirms
attachment, not successful delivery; verify a real `delivered` event and matching
chat record separately. SIGINT/SIGTERM first stop and drain Gainers, then close the
same existing TDLib client and exit. Existing source filters, synthetic backfill,
TraderRadio history import, and Slack paths are untouched. `--list-chats`,
`--dump-messages`, and non-watch runs never instantiate or mutate the outbox.

Additional local verification:

```
GAINERS_LISTENER_SNAPSHOT=/path/to/private/listener-snapshot.mjs node gainers-listener-glue.test.cjs
```

This checks the actual snapshot's exact anchors, insertion-only byte preservation,
and JavaScript syntax without starting Telegram or copying the source into a
public repository. Tests also cover config failure isolation, no-secret logging,
watch-only activation, resolved identity checking and shutdown ordering.
