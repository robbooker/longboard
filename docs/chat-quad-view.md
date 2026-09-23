# Quad chat view

`/chat/quad` is available from the normal chat three-dot menu. Choose up to four distinct authorized rooms or existing available DMs. Desktop uses two rows and two columns; expand restores the same mounted conversations. Phones (760px and below) use four conversation tabs. Empty slots are supported.

The browser saves only selected conversation keys in an account-scoped localStorage entry. Every load and periodic options refresh validates those keys against server-derived room entitlements and the existing participant-scoped inbox reader. Revoked choices are removed. Existing message, attachment, reaction, and send APIs retain their authorization. Gainers has no composer. No migrations or entitlement changes.

The existing PublicChat and DirectInbox components run in compact pane mode. One outer ChatUpdatesProvider coordinates batched reads and a single update subscription; presence remains per room. Only the outer shell observes DM notification sounds. App update controls mount once. Pane reply navigation does not alter shared browser history. Controlled DMs ignore global DM-open events and do not render or persist hidden room composers. Hidden mobile/expanded panes stay mounted to preserve drafts, but do not mark messages read. Text drafts use existing session draft persistence; uploads, pending sends, and open dialogs prevent changing selections. New DMs start in Single chat and then appear in the picker.

Existing per-conversation components keep their attachment and reaction scopes. The layout is remembered on this browser, not synced to other devices. Open the regular chat menu for account, notification, and appearance settings. A first-time member must finish choosing their chat name in Single chat.

Verification:
- Actual React component browser harness: LB/SS/two-DM isolated sends, pane-local thread bounds/history, Gainers read-only, expansion, saved selections/drafts, pending-send protection, revoked choices, single update subscription, 1440/900/390/320px layouts.
- Synthetic API and Supabase transport in that harness; no live messages or production credentials.
- Options-route tests verify denied callers, authoritative SS membership room scope, existing participant reader, private no-store responses, and failures.
- Layout parser rejects corrupt, duplicate, unauthorized and expired selections.
- Existing unit suite, TypeScript and targeted lint.

Run `node scripts/tests/chat-quad-browser.mjs` with Chromium available. Mobile checks use Chromium responsive viewports, not physical iPhone/Android hardware.
