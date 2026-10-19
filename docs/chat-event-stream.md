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

Outside the coordinator: room members (`RoomMemberList.tsx`, 120 s while the list is open and
visible, `/api/chat/room-members`; the server keeps each room's eligibility answer for a minute, see
`lib/chatRoomRoster.ts`)
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
2. **Threads, counts, pins (done, see section 9).** Number reply changes for the open thread and
   reply counts from the same rows, and pins (`chat_room_message_pins` changes into the room
   sequence). Retires readers 3, 4, 5. Also drop the full history re-read on reconnect for in-step
   rooms (the catch-up already covers it).
3. **Reactions (done, see section 10).** Reaction changes into the room sequence (one row per
   message and reaction set). Retires reader 6, and the room status reader 2 (pause/reopen as a
   numbered event).
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

## 9. Step 2: threads, reply counts and pins

Replies are room messages, so step 1 already numbers every reply change. Step 2 makes the three
readers that used to re-read on every room event (and every minute) take those numbered rows
instead, and numbers pins.

- **Numbered events.** While a room is in step, `useAblyRoomEvents` marks each room event it
  dispatches `numbered` (live rows, and every row and delete a catch-up applies) and no longer
  sends the blanket "room" reload with it; numbered "reload" signals (`history`, `room`) become
  the catch-up they trigger. `ablyRoomEventActions` decides this (pure, unit-tested). Events that
  are not numbered (stream off or killed, out of step, the Postgres channel) keep the old path
  exactly. A Longboard sign-in also has the Postgres channel: it no longer sends "room" reloads
  for a room that is in step either (`ChatUpdateCoordinator.streamInStep`).
- **Open thread** (`ChatReplyPanel`): merges numbered rows of its conversation (the first message
  and its replies) and drops deleted replies, with the same projection reuse as the room list
  (`realtimeRoomMessage`). It re-reads only when it cannot place a row: an author with no badges
  on screen, an older page (range) open, the conversation itself removed or deleted. A merged row
  is kept across a read that started before it (as a confirmed send is). Our own reply that is
  still sending waits for its own answer.
- **Reply summaries** (`useReplyThreads`, #464: count, last reply time, latest repliers): a
  numbered row that is a reply to a conversation the reader shows, or a deleted reply naming one
  (`numberedReplyConversation`), re-reads just that conversation's summary (one bounded
  `/api/chat/thread-counts` read with that id) and merges it into the held ones
  (`mergeReplySummaries`); the other conversations keep theirs. Summaries are not adjusted
  locally (the repliers list needs the server's current names), so that one small read is the
  source of truth. A change that lands during a read is read again afterwards, and a full read
  that lands meanwhile makes the partial one read again. A delete with no known conversation
  re-reads them all.
- **Pins** (`useRoomMessagePins`): migration `20261017140000_chat_room_event_stream_pins.sql`
  gives every pin and unpin (including a pin removed with its message) the room's next number
  (`longboard_chat_room_event_heads.pins_seq`), and the catch-up answers `pins` (the latest pin
  change number). `POST /api/chat/message-pins` now publishes a `changed: ["pins"]` signal with
  the head, so other windows hear of a pin at once (before: their next minute). In step, that
  signal is a catch-up, which reports the pin change, and the window re-reads its pins once.
  An edit of a pinned message re-reads them too (its preview). The pins reader relies on the
  stream only once a catch-up has carried `pins` (the migration ran); until then it keeps its
  minute timer and reloads directly on the signal.
- **Deletes name their conversation.** Tombstones keep `reply_to_id`, and the catch-up returns it
  as `parentId` (null for a top-level message), so a hard-deleted reply re-reads one count. A
  tombstone from before the migration has no `parentId`: every count is re-read, as before.
- **Timers.** The thread, counts and pins readers are stream readers of their room, so while it is
  in step they reconcile every 5 minutes instead of every minute (pins: once numbered). Ably down
  or out of step: their old timers (60 s live, 2 s / 10 s offline) come back unchanged.
- **Reconnect and the tab coming back.** A reconnect (`setHealthy(true)`) or the tab showing again
  (`visibilitychange`, `online`) used to re-read every reader, on top of the catch-up. Now a
  reader whose room has a resumable cursor (`ChatEventStream.covers`: stream on, connected,
  synced, under a day old; for pins, numbered) skips that run and is only re-timed, and the
  stream catches every attached room up from its cursor (`resume`). The catch-up brings the
  changed rows; one that is incomplete or a fresh sync re-reads every reader of the room (history,
  thread, counts, pins). The disconnect itself still re-reads everything and polls fast while
  Ably is down (the fallback is unchanged).
- **Flags.** The same `CHAT_EVENT_STREAM` and per-session kill switch: with either off nothing is
  numbered, so every reader behaves exactly as before step 1. Before this migration: replies
  and threads already work from step 1's numbers; pins keep their timer (no `pins` in a
  catch-up). Rollback: `supabase/rollbacks/20261017140000_chat_room_event_stream_pins.down.sql`.

Measured (synthetic fixture, `chat-event-stream-browser.mjs --minutes 6`, Alice, admin, desktop,
one room with one conversation open, Ably live, six idle minutes; the step 1 column is the same
test run on main with `--baseline`, its stream window):

| Reads per minute | Kill switch | Step 1 | Step 2 |
|---|---|---|---|
| Room history | 1.0 | 0.2 | 0.2 |
| Open thread | 1.0 | 1.0 | 0.2 |
| Reply counts (per counts reader) | 1.0 | 1.0 | 0.2–0.3 |
| Pins | 1.0 | 1.0 | 0.2 |
| All four | 4.0–5.0 | 3.2 | 0.8 |
| Est. DB calls, these readers (section 1 costs) | ≈ 10.5 | ≈ 6.5 | ≈ 2.2 |

So step 2 removes about 4 more DB calls per window per minute with a conversation open (about 1.5
without one), and the room's four readers together read less than once a minute while idle.
Event-driven work: a reply in the room costs a viewing window one summary re-read of that conversation (before: the
open thread, every count reader and pins, ≈ 6 calls); an edit in the open thread costs nothing; a
pin costs one catch-up and one pins read (before: nothing until the next minute). A reconnect or
the tab coming back costs one catch-up per room instead of re-reading history, thread, counts and
pins (≈ 11 calls); see `reconnectRoomReads` and `visibleRoomReads` in the test's `MEASURE` line.
In the fixture (Alice on the stream, Mallory on the kill switch, both dropped together, a thread
open): after the reconnect Alice re-read 0 of the room's readers (one catch-up) and Mallory 7;
over the whole drop, including the unchanged offline re-read and 2-second fallback, 8 against 12.
The tab hidden and shown again: Alice 1 catch-up and 0 reader re-reads, Mallory 5 re-reads.
Before the migration (checked by running the same test without it): replies, edits and the
reconnect behave as above; a pin reaches other windows through the direct `pins` reload.


## 10. Step 3: reactions and room pause/reopen

Reactions and the room's open/paused state become numbered room changes, so the reactions reader
(reader 6) and the room status reader (reader 2) stop polling while their room is in step.

- **Numbering** (migration `20261017150000_chat_room_event_stream_reactions.sql`). Every reaction
  set or cleared on a room message (member reactions in `chat_message_reaction_choices`, guest
  likes in `longboard_chat_reactions`) takes the room's next number in the writing transaction, in
  an AFTER trigger named `zz_…` (after the foreign key checks). The number is kept in
  `longboard_chat_room_reaction_events`: one row per message and reaction set, holding the number
  of that message's latest reaction change (kept 7 days). An upsert that changes nothing keeps its
  number; a reaction removed with its message is not numbered (the message's own change is). DM
  reactions are not numbered (step 4). A pause or reopen (`longboard_chat_room_state`: `is_open`,
  `paused_at` or `pause_reason` changed) takes the next number as
  `longboard_chat_room_event_heads.state_seq`. Lock order: reaction writers already lock the room
  state (for share) and the message (for update) first and take the number last; a pause holds its
  room-state row (no key update, which never blocks the key-share lock every message insert takes)
  and then the number, like any other numbered change.
- **Catch-up.** `chat_room_events_after` also answers `state` (the latest pause/reopen number, 0
  when none) and the messages whose reactions changed after the cursor. The route returns each as
  an event `{ seq, reactionsId }` beside the rows and tombstones (they count toward the 100 limit),
  and `state`, whose presence tells the window that reactions and room state are numbered.
- **Live.** The reaction signal (`changed: ["reactions"]` with its `messageId`) now carries `seq`,
  the number of that message's latest reaction change, read after the response (one indexed read
  on the server instead of a catch-up in every window). An in-order reaction moves the cursor with
  no read; a lost one shows as a gap at the next event and the catch-up names the message. Either
  way the window re-reads just that message's reactions (the same `CHAT_REACTION_EVENT` as before:
  `mine`, names and blocks are per reader, so the server's per-reader read stays the source of
  truth). A pause/reopen signal carries the head; in step it is a catch-up, which reports `state`,
  and the window re-reads the room status once (as pins do). A pause or reopen nobody published
  (a direct write) is noticed at the room's next event.
- **Readers.** The room status reader is a stream reader of its room (`streamNeed: "state"`). The
  reactions reader reads every room on screen at once, so it gives the coordinator the rooms it
  reads now (`watch(…, "rooms", () => rooms, "reactions")`): it relaxes from 30 seconds to 5
  minutes only while every one of them is in step with reactions numbered, and is re-timed when a
  room leaves step. A reconnect or the tab coming back skips their re-read when the cursor covers
  their rooms (DM reactions on screen are still re-read). A fresh sync or an incomplete catch-up
  also re-reads the status and the reactions on screen. Our own reaction no longer reloads the
  room's thread, counts and pins (`invalidate("room")`) while the room is in step, nor does a
  legacy like on the Postgres channel.
- **Flags.** The same `CHAT_EVENT_STREAM` and per-session kill switch; with either off nothing is
  numbered and every reader behaves exactly as before. Before the migration: the reaction signal's
  number read fails quietly (the signal goes as before), catch-ups carry no `state`, and both
  readers keep their own timers. Rollback:
  `supabase/rollbacks/20261017150000_chat_room_event_stream_reactions.down.sql`.

**CHAT-TIMING stream tag.** Every timing row now says whether the event stream was on for that
sample: `s: "on"` while the sample's room was in step (Ably live, stream on, cursor in step),
`"off"` otherwise (kill switch, flag off, Ably down, out of step). It is a state of the tab, never
an identity; the rest of the privacy rules are unchanged. The same migration adds
`chat_timings.stream` (`'on' | 'off'`, null for rows from before the tag), makes
`record_chat_timings` write it, and adds `chat_timings_daily_by_stream`. `GET
/api/chat/timings/stats` keeps `rows` unchanged (the dashboard's Chat speed page) and adds
`streamReady` and `byStream` (the same daily rows with `stream: "on" | "off" | "unknown"`).
Before the migration the route still accepts the tag and the old `record_chat_timings` ignores it;
the stats answer `streamReady: false, byStream: []`.

Measured (synthetic fixture, `chat-event-stream-browser.mjs --minutes 6`, Alice, admin, desktop,
one room with one conversation open, Ably live, six idle minutes; the step 2 column is the same
test run on main, its stream window; the kill-switch window is the same on both):

| Reads per minute | Kill switch | Step 2 | Step 3 |
|---|---|---|---|
| Room reactions (`/api/chat/message-reactions`) | 2.0 | 2.0 | 0.5 |
| Room status (`/api/chat?room=`) | 1.0 | 1.0 | 0.3 |
| History, thread, counts, pins (section 9) | 5.0 | 0.8 | 0.8–1.7 (the 5-minute confirm landed twice) |
| HTTP requests (all readers) | 11.5 | 10.7 | 9.0 |

So step 3 removes about 2.2 more reads (≈ 2.2 DB calls, one RPC each) per window per minute in a
room, and every room reader now confirms at most every five minutes while idle (the reactions
reader's confirm can redraw rows, which read their reactions once more). The remaining timed
reads are the inbox and feature notifications (6 / min each, steps 4 and 6) and the bell (2 / min,
step 5). Event-driven work: a reaction costs every window in the room one read of that message's
reactions, as before, and nothing else (before: our own reaction also re-read the thread, counts
and pins); a lost reaction costs one catch-up instead of up to 30 seconds' wait; a pause costs one
catch-up and one status read. The reconnect and the tab coming back re-read no reactions or
status in the stream window (`step3AfterReconnect`, `visibleRoomReads.step3` in the `MEASURE`
line: 0 against 4 for the kill-switch window). Delivery unchanged: send to painted p95 69 ms on
both. Timing tags in the same run: the stream window's beacon 11 "on" and 3 "off" (its page open,
before the first sync), the kill-switch window's 14 "off".
