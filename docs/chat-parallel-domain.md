# Parallel chat address

chat.robbooker.com is an additional hostname on the same production project, databases, code and membership authorization. It is not an independent staging deployment. Existing Longboard and ShortScout entry points remain unchanged.

Only the new host root redirects (307) to /chat. Cookies stay host-only: users sign in separately on the new host without changing existing sessions. Password recovery retains the existing configured Longboard destination. Phone installations and notification permissions are per origin; existing subscriptions remain intact.

ShortScout ChatConnect accepts only the two exact HTTPS origins. Unknown destinations fail closed before sending tokens. Missing origin retains legacy behavior. Login start sends chat_origin only on the exact new host. CORS remains restricted to ShortScout, with unchanged state, proof, one-use-code, and membership checks.

## Release order

1. Publish the ShortScout companion and verify its live bundle supports chat_origin while /chat retains its old destination.
2. Publish the owner-approved Longboard head through the dedicated release service.
3. Verify new-host HTTPS, root redirect, both login methods, room entitlements, attachments, notifications and old-host sessions. Both addresses share real data.
4. Keep both addresses for at least the requested test day. No automatic cutover is included; later migration requires separate approval.

No database migrations, membership modifications, cookie-domain changes, or environment changes required.

## Validation

685 unit tests (91 files), TypeScript, production build, focused lint and 71 release-service tests passed. Production HTTP tests use real Host headers to confirm exact new-host root redirect with preserved room query, legacy root unchanged, lookalike hostname excluded, and login pages accessible. ShortScout companion build, TypeScript, allowlist tests and actual-page Chromium tests passed using synthetic credentials and intercepted calls. Live authenticated membership/attachment/push smoke tests remain post-publication acceptance checks.
