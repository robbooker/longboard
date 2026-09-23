# DM alignment verification

Ticket `3861bff8-4d77-47b1-a781-1e534048ea99` makes both directions use the main room's full-width message structure. DM colors and membership badges remain unchanged. Identity and timestamp share the first row with actions alongside; body/media and the reaction footer span the message. Feed padding, row gaps, bottom padding and body typography match the main room. Pending deliveries use the same alignment. Main room files and behavior are untouched.

No migration is required. The release plan probes `/chat/login` for HTTP200 and `Sign in`.

## Reproduce the isolated browser check

Run `node scripts/tests/chat-dm-alignment-fixture.mjs`, then start Next:

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54536 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon \
SUPABASE_SERVICE_ROLE_KEY=test-service-role \
CHAT_MEMBERSHIP_EXPORT_KEY=synthetic-test-key-never-a-production-secret \
CHAT_TEST_SCANNER=isolated-fixture \
TRANSLOADIT_KEY=synthetic TRANSLOADIT_SECRET=synthetic \
NODE_OPTIONS='--require ./scripts/tests/chat-attachments-scanner-fixture.cjs --import ./scripts/tests/chat-dm-alignment-preload.mjs' \
npm run dev -- --port 3336
```

Then run `node scripts/tests/chat-dm-alignment-browser.mjs`. It uses Chromium at `/usr/bin/chromium` and compares real DM computed layout with the main room at320/390/768/1440 in dark/light themes. It exercises own/incoming and multiline messages, current LB/SS badges, image upload/preview, add/remove reactions and keyboard focus, edit action and edited timestamp, and a held pending send through confirmation. Screenshots go to `/tmp/dm-alignment-*.png`.

The data, signing key and scanner are synthetic and local. The legacy fixture lacks main-room unread sequencing, so only room opening-anchor responses are stubbed. DM opening, inbox, sending, editing, attachment handling and reaction API requests execute against the local fixture. Unrelated room-member count/favorites endpoints are unsupported by this adapter. This is not production, external malware-scanner, or complete room-unread verification. Never load the test preloads in a deployment.

Local validation passed: the browser matrix and interactions above, TypeScript, focused DirectInbox ESLint,11 identity/membership unit tests, diff whitespace checks, and the login release probe. The production build did not finish: both normal and IPv4-preferred attempts stalled on a Google Fonts HTTPS connection and were stopped. This is an uncompleted build check, not a successful build or a diagnosed application compilation error.
