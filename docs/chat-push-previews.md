# Device notification previews

Feature request: `87b0b600-ebf3-4e9a-8f12-f9a2263096c6` (iphone Notifications).

Phone notifications now offers an explicit per-device choice after notifications are enabled:

- **Off — keep notifications private** (default, including existing devices): generic activity only.
- **Sender only**: sender name and a generic message/activity description.
- **Sender and message preview**: sender name plus a short, sanitized message excerpt. Attachment-only messages say “Sent an attachment”; filenames, URLs, and attachment contents are not loaded for previews.

The control states that previews can appear on the lock screen and that the preference applies only to this device and future notifications. Already delivered notifications cannot be recalled. The example updates after a successful save. Failed saves leave the last confirmed choice displayed. The existing “Send test notification” remains a generic transport test; the example illustrates the chosen disclosure level.

## Privacy and delivery

The additive migration sets `preview_mode='off'` for every existing subscription. Only authenticated, same-origin requests scoped to both the current account and endpoint can change it. The new SQL functions are service-role-only and use security invoker with an empty search path. Neither a preference change nor viewing settings creates a subscription or prompts for permission.

The outbox still contains only message references and lease metadata. Delivery performs `prepare_chat_push_job` after claiming, immediately before encrypting/sending. It verifies the current lease, age, live device, message access, unread state, blocking, deletion, and applicable reply preferences through the existing target authorization function. It reads the current device choice and current source text. Off mode returns before retrieving any sender or text; sender mode does not return message text. A missing or failed recheck never sends the stale claimed payload.

The sender is included in the notification body, keeping compatibility with already-installed workers that use the fixed “Longboard Chat” title. Body size stays under their 160 UTF-16-unit limit, with control/bidi characters and markup stripped and no broken truncated surrogate pair. Preview text is not written into the database, outbox, logs, or release metadata. A push already sent to a provider cannot be recalled after a subsequent setting/access change.

## Verification

- 645 tests in 87 files passed; TypeScript and targeted lint passed.
- Isolated PGlite executes the actual baseline push migration plus the new migration. It verifies old-device default, account/device isolation, invalid preference rejection, anon/authenticated execution denial, no persisted private text, and changes after claim: off/sender/message preference, edited source, access revocation, block, deletion, read cursor, unsubscribe, and room reply preferences.
- Delivery tests prove failed or revoked preparation never invokes the push sender, and off mode never includes supplied private fields.
- Synthetic Chromium uses actual React components at 390px/1440px. It verifies explicit choices, private default on another device, reload of saved preference, failed-save recovery, existing enable/test/disable, account changes and worker isolation. Screenshots inspected: `/tmp/chat-push-previews-mobile.png` and `/tmp/chat-push-previews-sender.png`.
- No physical iPhone or live-provider delivery test was available. No production data, subscriptions, VAPID settings, migration, or deployment was changed.

Release migration: `20260919172901_chat_push_previews.sql`. Existing application versions continue generic notifications; the new sender requires this migration before deployment. Rollback to the previous application keeps notifications private and ignores the additive setting.
