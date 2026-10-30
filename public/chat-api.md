# Longboard Chat HTTP API (personal API tokens)

Base URL: `https://chat.robbooker.com`

A personal API token lets your own code use chat as you: the same rooms, the same names, the same
limits as the chat page. This page lists every route a token can call and what each one takes and
returns. Everything here was checked against the server code. Where a behaviour wasn't clear from the
code, it's left out.

## Quick start

1. Open `https://chat.robbooker.com/chat/developers` (you need an invite) and create a token. It looks
   like `lbc_` followed by 43 characters. You see it once, so copy it then.
2. Read the latest messages in a room:

```bash
export LBC=lbc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
curl -s -H "Authorization: Bearer $LBC" \
  "https://chat.robbooker.com/api/chat/history?room=social"
```

3. Send a message:

```bash
curl -s -X POST -H "Authorization: Bearer $LBC" -H "Content-Type: application/json" \
  -d '{"room":"social","action":"send","body":"Hello from my script","clientId":"'"$(uuidgen)"'"}' \
  https://chat.robbooker.com/api/chat
```

## Authentication

Send the token on every request:

```
Authorization: Bearer lbc_<43 characters>
```

- When a request has an `lbc_` Bearer header, the server uses only the token and never checks
  browser cookies.
- If the token is malformed, revoked or unknown, or its owner can't sign in any more (deleted or
  banned account, invite removed), the response is **401** `{"error":"invalid_token"}`.
- If the route isn't on the token allowlist, the response is **403**
  `{"error":"not_available_with_api_token"}`.
- POST routes reject a request whose `Origin` header names another site (403, for example
  `origin_not_allowed`). curl and server code send no `Origin`, so this doesn't affect them.

## Rooms

Room slugs: `main` (LB), `social`, `shortscout` (SS), `lb-announcements`, `ss-announcements`,
`gainers`, `lb-recordings`, `ss-recordings`, `developers`.

Which rooms you can see depends on your memberships (admins see every room):

| Room | Who can read |
|---|---|
| `main`, `lb-announcements`, `lb-recordings` | Longboard Boardroom members |
| `social`, `gainers`, `developers` | Longboard or any paid ShortScout member |
| `shortscout`, `ss-announcements`, `ss-recordings` | ShortScout mastermind members |

Who can write:

- `gainers` is read-only for everyone.
- In the announcement and recording rooms, only admins can post, edit or delete.
- Replies are turned off in the recording rooms.

**If you leave out `room`, the server uses `main`.** Always pass `room` explicitly.

### List the rooms you can see

No route returns only the room list. The `access` block of the batch read
(`POST /api/chat/updates`, see [Live updates](#live-updates)) carries it:

```bash
curl -s -X POST -H "Authorization: Bearer $LBC" -H "Content-Type: application/json" \
  -d '{"paths":["/api/chat?room=social"]}' https://chat.robbooker.com/api/chat/updates
```

```json
{
  "results": [{ "path": "/api/chat?room=social", "status": 200,
                "data": { "isOpen": true, "pausedAt": null, "notice": null, "updatedAt": "2026-10-21T14:00:00Z" } }],
  "access": { "accountId": "…", "rooms": ["main", "social", "lb-announcements", "gainers", "lb-recordings"],
              "canLinkShortScout": true, "member": { "id": "…", "display_name": "Rob", "accepts_requests": true } }
}
```

### Room status: `GET /api/chat?room=<slug>`

Returns `{ isOpen, pausedAt, notice, updatedAt }`. When a room is paused (`isOpen: false`), sends,
edits and reactions fail with **423** `chat_paused`.

### Your member profile: `GET /api/chat/member`

Returns `{ "signedIn": true, "member": { "id", "display_name", "accepts_requests", "name_revision" } }`.
`member` is `null` until you've picked a chat name. Most write routes answer `member_required` until
you have one. Note that this route answers a bad token with **200** `{"signedIn":false,"member":null}`,
not 401.

`POST /api/chat/member` with `{"action":"rename","displayName":"New Name"}` renames you. Names are
2–28 characters: letters, numbers, spaces, `. ' _ -`. A name that's taken returns 409.

## Reading messages

### `GET /api/chat/history`

| Param | Meaning |
|---|---|
| `room` | Room slug (required in practice). |
| `before=<seq>` | Up to 80 top-level messages older than this `unread_seq`. |
| `after=<seq>` | Up to 80 messages newer than this `unread_seq`. |
| `around=<messageId>` | A window of up to 80 messages centred on one message. |
| `range=<first>,<last>` | Messages whose `unread_seq` falls in this range (up to 80). |
| `latest=1` | Plain read only: also return `latestThrough`, the newest `unread_seq`. |

Use at most one of `before`, `after`, `around` and `range`. Sequence numbers are positive integers.

- **Without a window param**, you get the latest 80 top-level messages (thread replies are left
  out), oldest first, as `{ messages, reactions, latestThrough? }`. There's no `hasMore` field.
- **With a window param**, you get `{ messages, hasMore, hasNewer, range, reactions }`, where
  `hasMore` means older messages exist and `hasNewer` means newer ones do.

**Paging older messages:** take the `unread_seq` of the first (oldest) message, call again with
`before=<that seq>`, and stop when `hasMore` is `false`.

```bash
curl -s -H "Authorization: Bearer $LBC" \
  "https://chat.robbooker.com/api/chat/history?room=social&before=48211"
```

```json
{
  "messages": [{
    "id": "6f1c…", "room_slug": "social", "member_id": "a2b9…", "author_label": "Rob",
    "body": "Morning all", "bot_slug": null, "reply_to_id": null,
    "created_at": "2026-10-21T13:02:11Z", "edited_at": null, "deleted_at": null,
    "removed": false, "revision": 0, "attachment_ids": [], "client_id": "…",
    "buddy_status": null, "unread_seq": 48190, "memberships": ["LB"]
  }],
  "hasMore": true, "hasNewer": true, "range": "48131,48210",
  "reactions": [{ "message_id": "6f1c…", "guest_id": "…", "active": true, "created_at": "…", "updated_at": "…" }]
}
```

A message from a bot account has `"bot"` in `memberships`. A bot's name shows a "bot" badge in chat, and you can't start a DM with it.

The `reactions` array holds only the original "like" reactions. For every emoji, use
`message-reactions` (see [Reactions](#reactions)). A message with files has
`attachment_media` (file kind and image size) as well.

Bad params return **400** `invalid_window`. An `around` id that isn't in the room returns
**404** `anchor_not_found`.

### Where you left off: `GET /api/chat/opening?room=<slug>[&thread=<messageId>]`

Returns where your unread messages start:
`{ messageId, unreadMessageId, parentId, readThrough, latestThrough }`. Each field is `null` or `0`
when nothing is unread. With `thread`, it returns `{ messageId, readThrough, latestThrough }` for that
thread instead.

## Sending, replying, editing, deleting

### Send: `POST /api/chat`

```json
{ "room": "social", "action": "send", "body": "text", "clientId": "<uuid>",
  "replyTo": "<parent messageId, optional>", "attachmentIds": ["<uuid>"] }
```

- `body`: 1–600 characters after trimming. It can be `""` only when `attachmentIds` is non-empty.
- `clientId`: a UUID you generate, which makes retries safe:
  - Sending the same `clientId` again returns the original message, with no duplicate.
  - Reusing it with a different body, room or reply returns **409** `send_conflict`.
  - If you leave it out, the server picks one, so a retry would post twice.
- `replyTo`: the id of a message in the same room. A reply belongs to that message's thread. Returns
  **404** `reply_not_found` if the message isn't there, and **403** in the recording rooms.
- `attachmentIds`: up to 3 distinct file ids that are ready to send (see [Files](#files)).
- **Mentions:** write `@Display Name` in the body (case doesn't matter). The person gets a mention
  notification if they can read the room. `GET /api/chat/mentions?q=<prefix>` looks up names for
  autocomplete: it returns `{ "members": [{ "id", "display_name" }] }`, up to 10, and accepts a
  prefix of 0–28 characters.
- A body that is a summary command (handled by the chat page) returns 400.

Response: `{ "message": { …the stored message row, with "memberships" } }`.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_message`, `invalid_client_id`, `invalid_reply`, `invalid_attachments`, `invalid_room` | Bad input |
| 403 | `room_forbidden`, or a sentence | No access, or a read-only room |
| 409 | `member_required` / `send_conflict` | No chat name yet / `clientId` reused |
| 409 | "A file is no longer ready…" | A file isn't usable any more |
| 423 | `chat_paused` (+ `room`) | The room is paused |
| 429 | `rate_limited` (+ `message`) | See [Limits](#limits-and-notes) |

### Edit or delete: `POST /api/chat/message`

```json
{ "room": "social", "messageId": "<uuid>", "action": "edit",
  "body": "new text", "expectedBody": "the text you are replacing", "expectedRevision": 0 }
{ "room": "social", "messageId": "<uuid>", "action": "delete" }
```

- Edit: `body` is 1–600 characters. `expectedBody` must match the stored text exactly, or you get
  **409** `message_changed`. `expectedRevision` is optional (the message's `revision`).
- You can edit or delete only your own messages. Admins (and so an admin's token) can also delete
  other people's.
- Edit returns `{ "message": {…} }`. Delete returns `{ "deletedId": "…", "message": {…} | null }`.
  A deleted message that has replies stays as a placeholder (`deleted_at` set). Otherwise it's
  removed, and `message` is `null`.
- Errors: `invalid_action` / `invalid_message` (400), `room_forbidden` / `message_forbidden` (403),
  `message_not_found` (404), `message_changed` (409), `chat_paused` (423).

## Threads

- `GET /api/chat/thread?room=<slug>&messageId=<parentId>` returns
  `{ parent, replies, hasMore }`: the latest 100 replies, oldest first. The `before`, `after`,
  `around` and `range` params work as they do for history (up to 100). With them you get
  `{ parent, replies, hasMore, hasNewer, range }`. A missing parent returns 404, and recording
  rooms return 403.
- `GET /api/chat/thread-counts?room=<slug>&ids=<id>,<id>…` (up to 80 ids) returns
  `{ "counts": { "<id>": 3 }, "threads": { "<id>": { …last reply time and repliers } } }`.
- To reply, call `POST /api/chat` with `replyTo` set to the parent's id.

## Reactions

Emoji names: `like`, `heart`, `laugh`, `rob`.

### `POST /api/chat/message-reactions`

The target is either `{"kind":"room","room":"<slug>"}` or `{"kind":"dm","conversationId":"<uuid>"}`.

```json
{ "kind": "room", "room": "social", "action": "set", "messageId": "<uuid>", "emoji": "heart", "active": true }
{ "kind": "room", "room": "social", "action": "read", "messageIds": ["<uuid>", "…"] }
{ "kind": "room", "room": "social", "action": "details", "messageId": "<uuid>", "emoji": "heart", "after": "<cursor>" }
```

- `read` takes up to 100 ids. Both `read` and `set` return
  `{ "messages": { "<messageId>": [{ "emoji": "heart", "count": 2, "mine": true, "names": ["Ann", "Rob"] }] } }`.
  `names` holds the first 10 names.
- `details` returns `{ "people": [{ "id", "name" }], "nextCursor": "<id>" | null }`, 50 per page.
  Pass `nextCursor` back as `after` to get the next page.
- Errors: `invalid_target` / `invalid_reaction` / `invalid_cursor` (400), `room_forbidden` /
  `member_required` (403), `message_not_found` (404), `chat_paused` (423).

Two older routes also work. `GET /api/chat/reactions?room=&messageId=` lists up to 10 names of
people who gave a "like": `{ names, hasMore }`. `POST /api/chat` with
`{"action":"react","room":…,"messageId":…,"active":true}` sets a "like".

## Pins

`GET /api/chat/message-pins?room=<slug>` lists a room's pinned messages. Pinning
(`POST` with `{"room","action":"pin"|"unpin","messageId"}`) is for admins only. Anyone else gets
403 `admin_required`.

## Members

- `GET /api/chat/room-members?room=<slug>[&q=<name>][&cursor=<id>]` returns
  `{ "members": [{ "id", "display_name", "memberships": ["LB"] }], "nextCursor": "<id>" | null }`,
  50 per page. Add `&summary=1` to get only `{ "total": n }`.
- `POST /api/chat/room-members` with `{"room","ids":[…up to 20]}` returns the names for those
  member ids.
- `GET /api/chat/dm-members?q=<2–28 chars>` searches members you can start a DM with:
  `{ "members": [{ "id", "display_name" }] }`.

## Search

`GET /api/chat/search?q=<2–200 chars>&room=<scope>[&mode=keywords|meaning][&before=<iso>&beforeId=<uuid>]`

- `room` is a search scope: `main`, `social`, `shortscout`, `lb-social`, `ss-social`, `developers` or `all`
  (`all` covers LB + Social). The default is `main`. You need access to every room in the scope,
  or you get 403 `room_forbidden`.
- `keywords` (the default) returns `{ messages: [{ id, room_slug, author_label, body, created_at }], hasMore }`,
  20 per page, newest first. For the next page, pass the last result's `created_at` as `before`
  and its `id` as `beforeId`.
- `meaning` runs a semantic search, with no paging. It's limited to 30 searches an hour per
  account (**429** `search_rate_limited`).
- Search covers only `main`, `social`, `shortscout` and `developers`, never DMs.
- `GET /api/chat/search/context?id=<messageId>` returns `{ messages }`: the messages around a
  search hit.

## Direct messages

DMs live under `/api/chat/inbox`. You need a chat name and access to the Social room.

### List conversations: `GET /api/chat/inbox`

```json
{ "conversations": [
  { "id": "c0d1…", "status": "accepted", "incoming": false, "otherId": "<memberId>", "otherName": "Ann",
    "blockedByMe": false, "unavailable": false, "lastBody": "See you then", "updatedAt": "…",
    "latestIncomingSeq": 57, "unread": 1 }
] }
```

`status` is `pending`, `accepted` or `declined`. The list may start with a system entry whose
`id` is `room-summaries`: your delivered room summaries. You can read it with
`?conversation=room-summaries[&before=<seq>]`, but you can't reply to it.

### Read a conversation: `GET /api/chat/inbox?conversation=<id>`

- With no other params, you get the latest 50 messages, oldest first, and `hasMore`.
- Page older with `before=<seq>`, newer with `after=<seq>` (returns `hasNewer`), or centre on a
  message with `around=<messageId>` (up to 25 on each side).
- `ids=<id>,…` (up to 100) re-reads specific messages.

Messages look like
`{ id, seq, sender_id, client_id, body, created_at, edited_at, deleted_at, revision, attachment_ids, memberships }`.

### Actions: `POST /api/chat/inbox`

All actions take `{"action": …, "target": <uuid>, …}`.

| action | target | other fields |
|---|---|---|
| `request` | **member id** of the recipient | `body` (≤2000), `clientId` (uuid) |
| `send` | conversation id | `body` (≤2000, may be empty with files), `clientId`, `attachmentIds` (≤3) |
| `accept` / `decline` | conversation id | (you must be the recipient of a pending request) |
| `block` / `unblock` | conversation id | |
| `report` | conversation id | `body` = reason (≤1000) |
| `read` | conversation id | `clientId` = the **id of the newest message you have shown** |
| `edit` / `delete` | conversation id | `messageId`, `expectedRevision` (integer), `body` for edit (≤2000) |
| `settings` | (none) | `value`: boolean (whether you accept new message requests) |

- A request opens a pending conversation. You can't send more until the recipient accepts
  (`request_not_accepted`). If a conversation with that member already exists, the request
  returns it and posts nothing (`message: null`).
- Send and request return `{ "conversationId": "…", "message": {…} | null }`. Other actions return
  `{ "conversationId": "…" }` or `{ "ok": true }`.
- DM errors come back as plain sentences in `error`, not codes. Rate limits return **429**. Other
  failures mostly return **409**, and a missing message or conversation returns **404**.

```bash
curl -s -X POST -H "Authorization: Bearer $LBC" -H "Content-Type: application/json" \
  -d '{"action":"send","target":"c0d1…","body":"On my way","clientId":"'"$(uuidgen)"'"}' \
  https://chat.robbooker.com/api/chat/inbox
```

## Notifications and unread counts

`GET /api/chat/activity` returns your bell: mentions, reply alerts, DMs, reactions and per-room
unread counts.

```json
{ "mentions": [{ "id", "seq", "messageId", "room", "author", "preview", "createdAt", "category": "mention|reply", "read" }],
  "dms": [{ "id", "name", "unread", "throughSeq", "pending", "preview", "createdAt" }],
  "reactions": [ … ], "mentionCount": 2, "dmCount": 1, "reactionCount": 0,
  "mentionThrough": 812, "dmThrough": 57, "reactionThrough": 0,
  "roomCounts": { "social": 4 }, "roomThrough": { … }, "roomMessageCounts": { … }, "roomMessageThrough": { … } }
```

- Lists are capped (50 mentions, 100 DMs, 50 reactions), and the whole response stays under 32 KB.
- Without `?why=<anything>`, the server may return a copy up to 10 seconds old. Add `why` when you
  need a fresh read.

`POST /api/chat/activity` marks things read:

- **Mark a room read up to a message:**
  `{"kind":"room","room":"social","roomThrough":<unread_seq>,"mentionThrough":0}`.
- **Mark one mention read:** `{"kind":"mention","id":"<mention id>","mentionThrough":<seq>}`.
- **Mark everything read:**
  `{"kind":"all","mentionThrough":<n>,"dmThrough":<n>,"reactionThrough":<n>}`, using the `…Through`
  values from the GET.
- **Room notification level:** `{"kind":"roomLevel","room":"social","level":…}`.
- **Reply alerts on or off:** `{"kind":"preferences","replies":true|false}`.

## Live updates

There are two ways to get live updates: poll the batch read (works everywhere), or subscribe over
Ably (when realtime is switched on).

### Polling: `POST /api/chat/updates`

`{"paths": [ … ]}`: 1–8 distinct paths, with a body of at most 32 KB. Each path must be one of:

- `/api/chat`
- `/api/chat/activity`
- `/api/chat/inbox`
- `/api/chat/thread-counts`
- `/api/chat/history`
- `/api/chat/thread`
- `/api/chat/message-pins`
- `/api/chat/events`

Paths can carry their usual query strings. The server runs them all as you and returns
`{ results: [{ path, status, data }], access: { accountId, rooms, canLinkShortScout, member } }`.
A path that isn't on the list fails the whole batch with 400 `invalid_resource`.

A cheap polling loop: read `history?room=X&after=<newest seq you hold>` and `activity` in one batch
every few seconds.

### Change feed: `GET /api/chat/events?room=<slug>[&after=<n>]`

- Without `after`, it returns only `{ head, complete, events: [] }`. Keep `head` as your cursor.
- With `after`, it returns every change since then, oldest first. Each event is one of:
  - `{ seq, row }`: a new or changed message.
  - `{ seq, deletedId, parentId? }`: a removed message.
  - `{ seq, reactionsId }`: that message's reactions changed.
- The response may also include `pins` and `state`: the numbers of the latest pin change and the
  latest pause or reopen.
- More than 100 changes returns `complete: false` and no events. Re-read history instead.
- **404** `event_stream_off` means this feed is switched off for your account.

### Ably: `GET /api/chat/realtime-token`

This returns an Ably **TokenRequest** (signed by the server, valid for 1 hour). Pass it to an Ably
client through `authCallback`, and fetch a new one when Ably asks. If realtime is switched off for
your account, the route returns **404** `realtime_unavailable`.

Channels the token allows:

| Channel | Access |
|---|---|
| `private:chat:room:<slug>` | subscribe, one per room you can read |
| `private:chat:room:<slug>.typing` | subscribe; publish too where you can post |
| `private:chat:room:dm.<conversationId>.typing` | subscribe and publish, for DMs you can reply in |

There's no DM message channel. Get DM changes by polling `inbox` and `activity`.

Room channel events:

- **Name `message`:** `{ kind: "message", eventType: "INSERT" | "UPDATE", row: { id, room_slug,
  member_id, author_label, body, bot_slug, reply_to_id, created_at, edited_at, deleted_at, removed,
  revision, attachment_ids, attachment_media, buddy_status, unread_seq, event_seq }, head? }`.
  Edits and deletes arrive as `UPDATE`.
- **Name `changed`:** `{ kind: "changed", topics: [...], messageId?, head?, seq? }`. `topics` is any
  of `room`, `history`, `status`, `reactions`, `pins`. Re-read what the topics name; for example,
  `["reactions"]` with a `messageId` means re-read that message's reactions.

Typing events are named `typing`, carry no data, and are ephemeral. The sender is the Ably
`clientId`, `chat:m:<memberId>`.

Ably publishes can be lost. Run a slower poll as a backstop, as the chat page does.

## Files

Uploading a file takes four steps:

1. `POST /api/chat/attachments` with
   `{ "room": "<slug>" | "conversationId": "<uuid>", "filename", "mime_type", "byte_size" }`.
   - Accepted types: `application/pdf`, `image/jpeg`, `image/png`, `image/gif`, `audio/wav`.
   - Files can be up to 10 MB (WAV up to 5 MB). Filenames are 1–180 characters and their extension
     must match the type.
   - Returns `{ id, url }`, or 429 when you've hit the daily upload limit.
2. Upload the bytes to `url`, the storage upload link the server signs.
3. `POST /api/chat/attachments/<id>` checks and scans the file. It returns `{ "ready": true }`, and
   it can take several seconds.
4. Send the message with `attachmentIds: ["<id>"]`.

Uploads not finished within 2 hours expire. `DELETE /api/chat/attachments/<id>` cancels a file you
haven't sent yet.

Reading files:

- `GET /api/chat/attachments?room=<slug>&ids=<id>,…` (or `conversationId=`, up to 60 ids) returns
  metadata: `{ files: [{ id, filename, mime_type, byte_size, duration_seconds, preview_width, preview_height, thumbnail_available }] }`.
- `GET /api/chat/attachments/<id>` returns a **302** redirect to a short-lived signed download
  link. Add `?thumbnail=1` or `?preview=1` (images) or `?play=1` (WAV) for those forms. Tell your
  HTTP client to follow redirects.
- `GET /api/chat/attachments/<id>/transcript` returns
  `{ status: "ready", text } | { status: "none" | "processing" | "failed" }` for a voice message.
  `POST` to the same path starts a transcript and returns 202 while it's processing, or 429 when
  you've hit the transcription limit.

## Errors

Every error is JSON: `{ "error": "<code or sentence>" }`. Room routes use short codes. The DM,
member and file routes often use readable sentences instead.

| Status | Typical `error` | Meaning |
|---|---|---|
| 400 | `invalid_room`, `invalid_message`, `invalid_json`, `invalid_window`, `invalid_cursor` | Bad input |
| 401 | `invalid_token` | Token missing a valid format, revoked, or owner no longer signed in |
| 403 | `not_available_with_api_token` | Route not open to tokens |
| 403 | `room_forbidden`, `room_access_required`, `admin_required`, `member_required` | No access |
| 404 | `message_not_found`, `conversation_not_found`, `anchor_not_found` | Not found or not visible to you |
| 409 | `member_required`, `send_conflict`, `message_changed` | State conflict |
| 423 | `chat_paused` | Room paused |
| 429 | `rate_limited`, `search_rate_limited` | Slow down |
| 503 | `chat_unavailable`, `unavailable`, `…_unavailable` | Temporary server problem; retry with backoff |

## Limits and notes

- **The token is you.** Anything it does shows up as you, with your name and rights. If you're an
  admin, it has your admin rights in rooms (posting announcements, deleting other people's
  messages, pinning).
- **Revoke at any time** on `chat.robbooker.com/chat/developers`. You can have at most **5 active
  tokens**.
- **Not available with a token:** chat's admin panel, conversation summaries, the "Make clearer"
  writing helper, sign-in, phone notification settings and token management. Those routes answer
  403 `not_available_with_api_token`, and so does the same path inside a batch read. Features on
  allowed routes work as they do in the browser, under the same per-person limits: asking Buddy in
  a message, `mode=meaning` search and voice transcripts.
- **Rate limits the server enforces:**
  - Room messages: a pause of at least 1.5 s between sends (`rate_limited`, "Please wait a moment
    before sending again.") and at most 30 messages in 10 minutes ("Please pause before sending
    more messages.").
  - DMs: at most 60 messages in 10 minutes, and at most 10 new requests a day.
  - Semantic search: 30 searches an hour.
  - File uploads and transcripts have daily limits too.
- **Text limits:** room messages 600 characters, DMs 2000, DM reports 1000, chat names 2–28.
- Always send a fresh `clientId` (UUID) per message, so you can retry without double posting.
