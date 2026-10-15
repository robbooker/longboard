# EVENT-STREAM: one ordered stream of chat changes instead of timer readers

Ticket: EVENT-STREAM (approved). Follow-on: UNREAD-COUNTERS (bell and unread badges as
counters sent down the same stream) builds on step 1.

Goal: every change (message, edit, delete, reaction, read, pin, DM) reaches each person as a
numbered event over the one Ably connection the window already has. The window applies events
to what it holds and, after a gap or a reconnect, asks for "everything after N". The timer
readers retire one by one. Acceptance: database reads per active person drop sharply (measured
before and after), delivery lag p95 under 500 ms, and no reader polls faster than every 5
minutes while live. Done in steps, each shippable on its own.

## 1. The readers today

Every timed read goes through `lib/chatUpdateCoordinator.ts` (one 1-second scheduler per chat
shell, batched into `POST /api/chat/updates`, at most 8 resources per batch, one random phase
per window). "Live" means Ably connected (room events) or, for DMs, the Supabase Postgres
channel subscribed. "Offline" is the 2-second fallback for `fast` readers when nothing is live.
DB cost is counted from the reader code (Supabase calls per read, before Postgres work); every
batch adds about 2 more (sign-in context check and member lookup).

| # | Reader (file) | Resource | Interval: live / not live | DB calls per read |
|---|---|---|---|---|
| 1 | Room history (`room/useRoomHistory.ts`) | `/api/chat/history` | 60 s / 2 s | 4–6 (window, deletion evidence, reactions, badges, image sizes) |
| 2 | Room status (`PublicChat.tsx`) | `/api/chat?room=` | 60 s / 10 s | 1 |
| 3 | Open thread (`ChatReplyPanel.tsx`) | `/api/chat/thread` | 60 s / 2 s | 3–4 |
| 4 | Reply counts (`hooks/useReplyCounts.ts`) | `/api/chat/thread-counts` | 60 s / 2 s | 1 (RPC) |
| 5 | Room pins (`hooks/useRoomMessagePins.ts`) | `/api/chat/message-pins` | 60 s / 10 s | 1 (RPC) |
| 6 | Room reactions (`MessageReactions.tsx`, load) | `/api/chat/message-reactions` | 30 s / 5 s | 1 (RPC) |
| 7 | DM reactions (`MessageReactions.tsx`, loadDirect) | `/api/chat/message-reactions` | 5 s / 5 s | 1 (RPC) |
| 8 | Bell / unread (`hooks/useChatActivity.ts`) | `/api/chat/activity` | 30 s / 10 s | 2 |
| 9 | DM inbox (`DirectInbox.tsx`, two watches) | `/api/chat/inbox` | 60 s / 10 s (Postgres channel) | up to 9 |
| 10 | Quad DM options (`QuadChat.tsx`) | `/api/chat/inbox` | 60 s / 15 s (Postgres channel) | up to 9 |
| 11 | Feature notifications (`FeatureNotifications.tsx`, watch + own 15 s timer) | `/api/chat/features/notifications` | 10 s and 15 s | up to 4 |
| 12 | Features board (`FeatureChannel.tsx`, own timer) | `/api/chat/features?statusOnly=1` | 8 s | up to 4 |

Outside the coordinator: room members (`RoomMemberList.tsx`, 30 s, `/api/chat/room-members`)
and the app version check (`ChatAppControls.tsx`, 120 s, static). Neither is a chat change and
both are out of scope until the last step.

Already pushed today: room messages (insert/edit) as rows on `private:chat:room:<slug>`;
deletes, Buddy replies, Gainers and reactions as "changed" signals that make the reader
reload; typing on `….typing` channels. Every push is best-effort (`after()` the response);
the timers are what repair a lost one, which is why they cannot simply be turned off.

## 2. The event model

Choice: **one sequence per room, delivered on the existing room channels, plus a catch-up
endpoint**, and later **one sequence per person on `private:chat:user:<memberId>`** for what
is personal (DMs, reads, unread counters, the bell).

Why not one per-person sequence for everything now: numbering each change once per reader means
fan-out writes (one row per member per message) and a publish per person per message. Room
changes are the same for every reader of the room, so one number per room change, published once
to the room channel, is cheaper and keeps the room channel's existing auth. Personal changes have
exactly one audience, so they get their own per-person sequence later, on a per-person channel
(the token already pins `clientId` to `chat:m:<memberId>`, so the capability can name only that
member's channel).

Numbering (migration `20261017130000_chat_room_event_stream.sql`):

- `longboard_chat_room_event_heads(room_slug, seq)`: the last number handed out per room.
- `longboard_chat_messages.event_seq`: the number of the row's latest change. A BEFORE trigger
  named `zz_…` (so it runs after every other BEFORE trigger) takes the room's next number on
  insert and on any update a reader can see (an update that changes only `search_document` keeps
  its number). Because it runs in the writing transaction, every writer is numbered: the app's
  routes, RPCs, Buddy, Gainers, cascades and anything that writes directly.
- `longboard_chat_room_event_tombstones`: hard deletes (a message with no replies), numbered
  the same way, kept 7 days.
- The head row stays locked until the writing transaction commits, so numbers commit in order
  within a room. Writers in one room queue for that moment; rooms never wait on each other.

Events are **current state, not operations**: a live event carries the changed row with its
`event_seq`; a catch-up returns the rows changed after N as they are now. Applying a row twice is
harmless, and the list's existing revision check keeps an older state from replacing a newer one.

## 3. Ordering, dedup and gaps

A window keeps, per room it shows, a cursor `head`: every change numbered at or below `head` has
been applied there.

- A live row numbered `head + 1` moves `head` forward. A number at or below `head` is a duplicate
  or an older change: applied (harmlessly) but not counted.
- A number above `head + 1`, or a published `head` above the cursor, is a gap: the window asks
  `GET /api/chat/events?room=R&after=head` (through the batched updates route) and applies the
  answer exactly like live events.
- Edits, deletes and "changed" signals (when the flag is on) also carry the room's `head` at
  publish time, read after the write. That catches changes nobody published (cascaded deletes,
  Buddy's status change, direct writes) at the next event. A plain send does not read the head,
  so sends keep their speed; its own number is enough.
- `head` moves only by its own next number or by a catch-up, whose rows and head come from one
  database snapshot, so the rule above can never skip a change. A catch-up that ends below a
  number heard before it started proves that number wrong; the cursor never loops on it.
- Events that arrive while the tab is hidden are not applied, so they are not counted either;
  the next event shows the gap (and the coordinator re-reads everything when the tab shows).

## 4. Catch-up ("everything after N")

`GET /api/chat/events?room=R[&after=N]` (`lib/chatReads/events.ts`, also allowed inside
`/api/chat/updates`):

- Without `after`: only the room's head (a fresh cursor). The window then does one full history
  read, so everything up to that head is covered, including anything before the channel attached.
- With `after`: `{ head, complete: true, events: [{ seq, row } | { seq, deletedId }] }`, oldest
  first, at most 100. More than 100 answers `complete: false` and the window does one full history
  read instead.
- A cursor older than a day is not trusted (tombstones last 7 days): a fresh sync.
- A catch-up only starts after the room's channel has attached (first attach, after a reconnect,
  or Ably re-attaching without continuity), so its snapshot covers everything the channel did not
  deliver. The cursor survives a dropped connection, so a reconnect asks only for what came after
  it.
- A failed read is retried after 5 s, doubling to 5 minutes; meanwhile the room is out of step
  and its reader keeps its old timer.

## 5. Auth

The same audience and columns as the room's Ably channel: `requireChatUser`, then
`canAccessChatRoom` (anyone who may read the room may catch up on it), and only the published
display columns (`publishedRow`: never `client_id`, `guest_id` or `search_document`). The tables
and the `chat_room_events_after` function are service-role only (RLS on, no browser grants).
Room channels stay subscribe-only. Per-person channels (later steps) are granted by the token
route for exactly the member's own `private:chat:user:<memberId>`.

## 6. Flags

- Server: `CHAT_EVENT_STREAM` = `off` (default, also when unset) | `admins` | `all`. Off: the
  events route answers 404 (the window stops asking for the page session) and publishes carry no
  head. Ably itself still needs `CHAT_ABLY_ROLLOUT`.
- Per session: `sessionStorage["longboard-chat-event-stream"] = "off"`, or open any chat page with
  `?eventStream=off` (`?eventStream=on` clears it). That window never asks for events and keeps
  every timer exactly as before.
- Before the migration is applied: rows carry no `event_seq`, the events route finds no
  `chat_room_events_after` and answers 404 as if off, and the head read on publish fails quietly,
  so nothing changes. Still, apply the migration first, then turn the flag on.

## 7. Steps

1. **Room messages (this change).** Numbered room message inserts, edits and deletes (soft and
   hard), the catch-up endpoint, the cursor in `useAblyRoomEvents`. Retires: the room history
   reader's 1-minute timer while live (reader 1 now reconciles every 5 minutes; still 2 s when Ably
   is down). Numbered "reload history" signals for an in-step room (Buddy, Gainers, deletes) become
   catch-ups instead of full history reads.
2. **Threads, counts, pins.** Number reply changes for the open thread and reply counts from the
   same rows, and pins (`longboard_chat_room_message_pins` changes into the room sequence).
   Retires readers 3, 4, 5. Also drop the full history re-read on reconnect for in-step rooms
   (the catch-up already covers it).
3. **Reactions.** Reaction changes into the room sequence (one row per message and reaction set).
   Retires reader 6, and the room status reader 2 (pause/reopen as a numbered event).
4. **Per-person channel.** `private:chat:user:<memberId>`, its own sequence and catch-up, DMs and
   DM reactions on it. Retires readers 7, 9, 10 and the Postgres channel for DMs.
5. **UNREAD-COUNTERS.** Reads, unread and the bell as counters on the per-person stream. Retires
   reader 8.
6. **Features.** Ticket and notification changes on the per-person stream. Retires 11 and 12.
   Then every remaining reader runs at most every 5 minutes while live.

## 8. Measured (step 1, synthetic fixture)

`scripts/tests/chat-event-stream-browser.mjs` keeps two windows in one room, one with the stream
and one with the per-session kill switch (the old behaviour), and prints a `MEASURE` line.
`--minutes 6` idles six minutes; `--baseline` swaps the windows so the same account is measured
both ways. Alice (admin, desktop, one room open, Ably live), six idle minutes:

| | Kill switch (before) | Stream (after) |
|---|---|---|
| Room history reads | 6 (1.0 / min) | 1 (0.2 / min) |
| Resources read (all readers) | 123 (20.5 / min) | 118 (19.7 / min) |
| HTTP requests | 10.5 / min | 11.7 / min (same batches; history rode in them) |
| Est. DB calls (section 1 costs) | ≈ 114 / min | ≈ 110 / min |

Step 1 removes about 4 DB calls per window per minute (the history read is the most expensive
single read, ≈ 5 calls). The large remaining costs are the inbox (≈ 54 / min) and feature
notifications (≈ 24 / min), which steps 4 and 6 retire. Event-driven work also gets cheaper: a
missed publish, a delete, a Buddy reply or a Gainers alert in the open room now costs one
catch-up (1 DB call) instead of a full history read.

Delivery (same runs, local fixture, n = 10 sends): send pressed to row painted on the other
screen p50 60–69 ms, p95 71–92 ms; server publish to painted p95 30–48 ms. A plain send does no
extra read before it is published.
