# Reactions on room messages, replies and DMs

Ticket 3fcb568b-b633-4c26-836e-c83d9430e616 adds a shared MessageReactions footer. ADD REACTION appears on hover or keyboard focus and remains visible for touch; a native modal picker offers Like, Heart and Laughing. Active count chips toggle the caller's reaction and expose participant names in their accessible label/title. Public likes keep palm/lemon identity; DM likes use thumbs-up. Picker Escape/Close and asynchronous-save focus return preserve the surrounding conversation. Message bodies, attachment IDs and audio rendering are unchanged.

## Compatibility and authorization

Migration 20260918182733 is additive. Existing public like rows, primary key and API remain unchanged; the new 'like' action writes those same rows. A separate table holds public heart/laugh and all DM reaction choices, with exactly one foreign-key target, bounded emoji values, per-target/member/emoji uniqueness, RLS and no browser-role privileges or realtime publication. Server-only invoker RPCs derive the member from the authenticated account. The API ignores client actor fields and accepts explicit boolean desired states (safe repeated requests), bounded scoped batches and known emoji values only.

Room writes verify membership, exact room/message scope, bilateral blocks and open state. DM writes require current membership, conversation participation, accepted status, no bilateral block and a nondeleted message. Reads repeat those checks before exposing counts/names; revoked, blocked and deleted targets return no reaction details. Room pauses retain readable history. No new raw DM realtime data is exposed.

Writes use the existing actor→pair→conversation→message DM lock order. Room writes use actor→pair→shared room-state lock→message lock: pause updates take the state lock; existing message mutators do not acquire a state lock after the message lock, so this introduces no reverse cycle. The mutation remains inside the same transaction as its permission checks. PGlite validation checks both serialized state-change orderings, but is not a multi-session PostgreSQL contention test.

## Refresh behavior

Explicit view-active guards exclude covered mobile room/DM views; one provider tracks visible footer targets with IntersectionObserver and batches up to 100 IDs per room/conversation. Independent scopes load concurrently without using or delaying critical message transport. The existing coordinator reconciles at five seconds; hidden pages stop reads, inactive/offscreen scopes unregister, and overlapping/obsolete reads are aborted. Successful writes update shared summaries immediately and invalidate the relevant coordinator topic. No per-card polling.

## Validation

- TypeScript, targeted ESLint and production build pass.
- Full unit suite: 484 tests. New API cases cover trusted actor/scope, malformed payloads, login/origin/access, bounded reads and safe errors.
- Isolated database: 31 assertions covering legacy preservation, idempotency, count/names, target mismatch, paused like/unlike, revoked membership, pending/blocked/deleted DM protection, read-time privacy and browser-role denial.
- Synthetic browser ports 3274/54474: desktop and mobile room/reply/DM picker, keyboard and touch input, cross-user reconciliation, reload/unlike, announcement reader palm/lemon and old API compatibility, unauthorized/blocked DM reads/writes, inactive-scope and hidden-page polling, light/dark DM contrast, picker Escape and save focus restoration.
- Screenshots `/tmp/reactions-public-mobile.png`, `/tmp/reactions-thread-mobile.png`, `/tmp/reactions-dm-desktop.png`, `/tmp/reactions-dm-mobile.png`, `/tmp/reactions-dm-mobile-light.png`; representative desktop/thread/mobile-light images visually inspected.
- Evidence `/tmp/message-reactions-{unit,db,browser,focus,build}.log`. Mobile is Chromium touch/viewport emulation. The older fixture has unrelated activity-read 503 responses; notification delivery is not claimed. No real messages or production data were used.

The migration digest is pinned in the per-ticket release manifest. Its public login probe is smoke coverage, not authenticated acceptance. Voice-first integration was validated after merging published main 080f179e69d650a1c257ee4da2c54ed862bd3344. The integrated suite passes 529 unit tests, TypeScript, targeted lint, production build, both SQL suites (31 reaction and 27 voice assertions), and the reaction browser suite including hidden/inactive scopes. A dedicated synthetic browser test records, uploads and sends audio in rooms, replies and DMs, adds a heart to each recorded message, and verifies intact playback/transcripts plus responsive widths 320/390/768/1440. It also preserves voice discard/error/draft checks. Integrated logs are `/tmp/reactions-integrated-{unit,tsc,lint,db,voice-db,browser,voice-browser,build}.log`; no live provider calls are made.
