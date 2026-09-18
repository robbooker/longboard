# Compact DM header

Request f2b85b2f-5f06-4feb-ac82-caf38a92f785. DMs now use one compact top row: a smaller back arrow with the current room name, the recipient name, and the existing search, notification and settings icons. Clicking the room button returns to the existing room view. The duplicate Private conversation subtitle, PRIVATE MESSAGES/Back to room row and person/block/report row are removed.

The owner's additional sound-control request is included: Conversation sound, its selector and Test conversation sound no longer occupy the message pane. Chat settings → DM settings opens the selected conversation's sidebar disclosure. It contains the same sound choices/test and existing block/report actions. Global sound controls remain in the sidebar. On mobile this opens the navigation drawer; returning to chat restores the conversation. New-request accept/decline and message/report forms remain in the conversation. No backend or authorization behavior changed.

The current room's controls and presence remain unchanged outside DMs. Feature notifications move to navigation while a DM is displayed so the header keeps the requested three action icons. Long names truncate visually in the single row with the full name available in the heading's title and accessible text.

Validation evidence is recorded in the final handoff: full unit suite, TypeScript, targeted lint, production build and `scripts/tests/chat-dm-header-browser.mjs`. The browser covers desktop1440, mobile390 and320popout, compact header geometry, absence of sound controls/extra headers in the conversation, menu access to sound selection/test, bell/search/back and retained room drafts. Screenshots `/tmp/dm-header-{1440,390,320}.png` and corresponding `/tmp/dm-header-settings-{1440,390,320}.png`. Mobile is Chromium emulation, not physical Safari.

Release plan `.release/f2b85b2f-5f06-4feb-ac82-caf38a92f785.json` is migration-free. The login probe is only a smoke check; authenticated browser tests establish the UI behavior. No push or production operation was performed.
