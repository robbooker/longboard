# Phone notification title and preview

Ticket `7b2965ed-4bea-4b38-b58c-37b825294abb` changes the presentation of existing chat pushes. Previously the sender emitted the fixed title “Rob Booker Chat” with a combined sender/message body, and the worker ignored the supplied title. The new payload uses native title and body fields:

| Device preference | Title | Body |
| --- | --- | --- |
| Off or unknown | Rob Booker Chat | You have a new chat notification. |
| Sender only | DM - Luke / Social reply - Luke | You have a new chat notification. |
| Sender and message | DM - Luke / Social reply - Luke | Up to 40 Unicode code points of message text, including any ellipsis |

Room labels are a fixed allowlist: LB, Social, SS; existing room categories are mention and reply. DM uses its own fixed label. Missing or unrecognized context uses “Chat”; an absent sender uses “Someone.” No new push categories are enabled. Announcements, recordings, reactions, pending DM requests, and other previously non-pushed events keep their existing delivery behavior.

The sender is sanitized and limited to 40 Unicode code points; the final contextual title fits within the worker's 64-code-point cap. Text strips markup, formatting controls and line breaks; truncation never leaves a lone surrogate. The 40-character contract counts Unicode code points, not grapheme clusters or rendered glyphs. Empty message-mode bodies use “Sent an attachment.” or “Sent a message.” without attachment names or media fetches. Sender-only never includes message or attachment text. Off/unknown never includes sender or contextual room/category in the visible title/body.

## Privacy and delivery boundary

`prepare_chat_push_job` remains service-only, `SECURITY INVOKER`, with an empty search path. It preserves the current lease, completion and five-minute age checks; subscription lookup; and unchanged `chat_push_target` recheck. Only explicit sender/message modes may read and return sender plus room/category metadata. Only message mode returns body and the attachment flag. The title/body formatter independently rejects all other privacy values even if private fields were supplied.

The migration changes no tables, subscription preferences, queues, targets, triggers, claim/finish behavior, read markers, retries, device ownership, or permission requests. Current sender names and edited text are read at preparation. The existing ShortScout push eligibility uses the preserved 12-hour offline recipient window, with known authoritative denial suppressing delivery; this work does not promise instant upstream revocation or change that policy. Already delivered previews cannot be recalled.

The worker now honors a bounded, sanitized payload title and body through `showNotification`. Existing icon, badge, tag, same-origin `/chat` click restriction, exact-window focus, and separate-window behavior for other conversations remain unchanged. The settings dialog only updates its static example. Explicit opt-in and per-device privacy controls are unchanged.

## Compatibility and rollout

The CLI-created migration is `supabase/migrations/20261002153528_chat_phone_notification_layout.sql`. SHA-256: `0474b0ee4294b2fb170120d3f6da22aaa5bd8d0fb612e466ca1e0f591d9b213b`.

It is additive to the preparation JSON. Old application code ignores the new keys. New application code with the older preparation function safely uses the generic “Chat” context for room notifications. New workers accept legacy/malformed payloads with generic fallbacks and bound their text. An old worker receiving a new payload still shows the generic application title and short message body until its normal update; this rollout does not force activation, reload tabs, or interrupt drafts. Rolling back the application remains safe with the added metadata, though old formatting may remain until the corresponding worker updates normally.

The final implementation includes published Ticket Delete and Notification List main `298bb5eaa68e9f4e6cded7cac73884438ac5cb9f`; final combined validation is complete. The coordinator retains exact-version registration, hosted checks and authorization. Publication uses the existing dedicated service only. This implementation does not read production credentials, send real pushes, change release infrastructure, or require external purchases.

## Validation evidence

Final combined validation after the parent integrated published main `298bb5eaa68e9f4e6cded7cac73884438ac5cb9f` (implementation checkpoint `9c29bfff61bb6ef2b048427872ca086843581475`; subsequent edits only extend this database regression and evidence):

- 941 unit tests across 114 files; focused push/route/worker/browser-helper subset: 39 tests.
- New current-schema SQL fixture: 119 assertions, using real migrations through published Notification List and the new migration. Verifies unchanged target/queue/claim/finish/subscription/read/history definitions; actual read RPCs retain read room/DM rows without allowing their push preparation, and old observed cursors preserve later push candidates; service-only invoker grants, per-device private/sender/message projection, current author names and edits, all supported room/category combinations, post-claim lease/age/completion/read/block/delete/reply-preference/unsubscribe gates, and ShortScout offline expiry/known-deny behavior.
- Existing push-preview SQL suite, 101 Notification List, 49 Formatting, 105 ShortScout authorization, 35 exact-visible notification and 98 Ticket Delete database assertions pass.
- Actual registered Chromium service worker: 63 assertions. Synthetic push events pass real formatter output into the worker. Native display/client APIs are stubbed to inspect title/body, Unicode bounds, hostile/malformed/legacy fallbacks, icons/tag, click allowlist, exact-client focus, separate-window routing, untouched draft, and absence of forced activation or external requests. Browser: Chrome 152.0.7977.82.
- Existing actual React settings/menu browser suite passes desktop/mobile, explicit permission/enable/disable, private defaults, saved choice reload, per-device/account isolation, failed-save retention, and existing draft/upload refresh guards. The updated title/body examples are asserted for sender and message modes. Mobile screenshot inspected: `/tmp/chat-push-previews-mobile.png`.
- The final production Next app and synthetic current-schema notification fixture on assigned ports 3365/54565 pass the published Notification List browser matrix: seven forms, read/retry/held-cursor behavior, retained row navigation without redundant manual acknowledgements, deletion, Quad visible acknowledgement, responsive layouts, and unchanged feature-notification revisit. The actual activity hook/coordinator browser test passes account/member and A→B→A replacement, stale GET/POST fencing, standalone refresh replacement and cleanup. Zero browser runtime errors; owned servers stopped after verification.
- TypeScript, lint (0 errors; 10 existing unrelated warnings), production build and 71 release-service tests pass.

Database fixtures use isolated sequential PGlite, not production or a native concurrent PostgreSQL deployment. Browser tests use synthetic permissions/subscriptions and stub notification delivery; no actual provider sends or physical iOS/Android tests occurred. Settings screenshots show the settings example, not an operating-system notification.

## Native presentation references

[Apple's Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) describes standards-based notification delivery and user-initiated permission; [WebKit's iOS/iPadOS guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) describes Home Screen web-app notifications appearing on native notification surfaces. [Google's notification display guide](https://web.dev/articles/push-notifications-display-a-notification) documents separate `showNotification(title, { body })` fields and differences in presentation across platforms. Exact line wrapping, truncation, and expanded/collapsed layouts belong to the operating system and browser. This change supplies short plain-text native fields; it does not promise identical physical layouts.
