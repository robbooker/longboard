# Chat header and room cards

Approved request: `02c3b5f0-8abf-412e-890d-fa38b45474b6`, revision 2 (CHAT HEADER + BOXES).

The header now names the community (Longboard, Social or ShortScout) and provides a Search chat control alongside existing notifications, inbox and settings. Sidebar room cards use the current theme's panel, border and accent colors, with a highlighted selected card. Existing membership gates and the private Features link are unchanged.

Direct messages sit below the room cards, with pending requests, conversation previews and unread badges. At desktop widths (1100px and above), selecting one shows the existing private conversation UI in the central chat area. Room history stays mounted and its unsent draft is retained. Selecting a room or Search returns to that view; Back to room and Escape also leave the desktop inbox. Room mention read markers and auto-scrolling pause while the central area displays a DM. The room's reply panel is hidden during the DM and restored on return.

One DirectInbox instance owns subscriptions, polling, sending and request state; React portals place its list and conversation in their respective layout slots. The existing authenticated inbox API, request acceptance, block/report controls and settings remain in use. Smaller screens retain the arrow navigation and modal inbox. Resizing between desktop and mobile retains the active conversation and DM draft and restores composer focus. No database migration or API change is required.

## Validation

Use the dummy-account fixture and app server documented in `chat-mobile-replies.md`, then run:

- `node scripts/tests/chat-header-cards-browser.mjs`
- `node scripts/tests/chat-mobile-browser.mjs`
- `npm test`
- `npx tsc --noEmit`
- `npx eslint components/chat/PublicChat.tsx components/chat/DirectInbox.tsx`
- `npm run build`

The new browser check exercises real local API request acceptance and sending, unread sidebar cards, desktop center placement at 1100/1280/1440/1920, room/search switching and room-draft retention, mobile navigation at 320/390/768, and a mobile/desktop resize with an unsent DM draft. The existing thread flow checks nested replies, navigation, focus, scroll and the right sidebar. All accounts and messages used are isolated test data. Physical iOS/Safari remains untested.
