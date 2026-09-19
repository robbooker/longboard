# Chat phone app and notifications

Chat can be added to a phone Home Screen with a chat-only manifest, icon and start URL. iPhone/iPad require iOS/iPadOS16.4+ and installation before enabling push. Android Chrome can enable from the browser or installed app. This is a web app, not an App Store package.

## User flow

Chat settings → Phone notifications & install → Enable notifications. Permission is requested only after a button click. Test and disable are per-device. DMs must be accepted; mentions and replies follow current authorization and the existing reply-alert preference. Notifications say only “You have a new chat notification”; no message text, names or attachments are included. Clicking opens the exact authorized DM/thread in a separate window if needed, preserving drafts in existing windows. Announcements and feature updates are not included in this first version.

A new version produces an eight-second dismissible notice. Refresh app remains in the three-dot menu. Text drafts use bounded member-scoped sessionStorage, expire after two hours, and are cleared on detected session loss. The app refuses to refresh with attachments, recording, pending/failed sends or failed draft storage. Guard runs again after worker activation. The push worker does not intercept fetches or cache chat history; there is no offline chat.

## Server delivery

Service-only subscription and per-device outbox tables have RLS and revoked anonymous/authenticated grants. Message/alert inserts atomically enqueue jobs; after-response work accelerates delivery with a minute cron fallback. Claims recheck membership, deletion, unread state, blocks and reply preferences. Leases prevent simultaneous sends; retries are bounded and old events expire after five minutes. Provider acceptance is not proof of handset delivery. A crash after acceptance can retry; stable notification tags collapse repeats. Cleanup removes old jobs and expired subscriptions.

Exact provider allowlist: Apple web.push.apple.com, Google fcm.googleapis.com/fcm/send, Mozilla updates.push.services.mozilla.com/wpush. Other providers, including Edge WNS, are not enabled in v1. Chat worker /chat-sw.js uses /chat scope; existing stock-alert OneSignal worker is untouched. Account IDs are checked on every mutation; device endpoints cannot silently transfer between accounts. Explicit chat logout revokes this device before logout. Signing out elsewhere does not currently disable all devices; use device settings to disable. Generic lock-screen notifications contain no account content.

## Required deployment configuration

Run `node scripts/chat-push-setup.mjs` from this checkout and enter a Vercel token scoped to Longboard in its hidden prompt. The script generates a P-256 keypair in memory and stores CHAT_PUSH_PUBLIC_KEY, CHAT_PUSH_PRIVATE_KEY and CHAT_PUSH_SUBJECT in Vercel production as sensitive variables. It does not print keys, save the token, rotate existing keys or deploy. Existing CRON_SECRET remains required. Production variables must be configured before release. Keep the private key stable or devices must resubscribe. Setup has not yet been executed against production.

Migration20260919020901_chat_web_push.sql must be applied only by the dedicated release service after exact-version publishing approval. No production migration has been applied by the desktop.

## Verification

Unit and SQL tests cover endpoint allowlisting, account-switch/ownership checks, leases, retries, deleted/blocked/read/revoked event suppression, anonymous denial, safe click URLs and draft isolation. Chromium fixtures cover actual React menu/settings at390/1440px, install guidance, explicit permission, test/disable, wrong-worker isolation, focus return, real reload draft recovery and busy refresh cancellation. Live Apple/Google delivery and physical iPhone/Android install flows remain a required post-deployment device test.
