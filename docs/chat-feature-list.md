# Chat — running feature list

Updated September 16, 2026.

## Direction agreed

**One chat app with many rooms.** Each community can retain its own branding and verified membership rules. Shared Social and webinar rooms fit within the same application. ShortScout membership login, account linking and a shared canonical domain are not yet configured; SHORTSCOUT remains an admin preview.

## Next — first build priority

- [ ] **Attachments in the + menu.** Proposed first version: images and PDFs, upload progress, previews and private room-authorized downloads. Include pasting an image from the clipboard directly into the chat composer. See [attachment architecture](chat-attachments.md). Not implemented.

## Planned

- [ ] **Typing indicators (typing bubbles).** Show “Rob is typing…” or animated dots while members compose a message. Room-scoped and visible only to authorized participants; short-lived signals that clear after sending, inactivity or disconnect. Do not transmit draft text or store typing events in message history. Planning only; not implemented.

- [ ] **Personal settings.** Font choices and related display preferences.
- [ ] **Search refinements.** Improve relevance, add date filters and consider topic windows.
- [ ] **Membership access.** Verify Longboard and ShortScout access independently; easy switching for dual members and shared Social access. Confirmed SS policy: paid monthly, annual, lifetime and mastermind memberships qualify; free ShortScout accounts do not. Verify active/expired/revoked status against the authoritative backend before granting access. Rob confirmed current paid members are mastermind members with perpetual access; no expiration workflow is needed for the initial rollout. Implementation awaits verified ShortScout backend access.
- [ ] **Embedded webinars + event rooms.** Replace the command2 video placeholder with a member-authorized player and connect its separate Boardroom chat to the shared room system. Each event gets a room, recording/transcript links and searchable chat. Choose technology after confirming the current host tool, audience participation and acceptable delay. See [webinar plan](chat-webinars.md).
- [ ] **Phone app chat.** Bring the shared experience into the authenticated phone app.
- [ ] **More + menu additions.** Stickers and stock cards such as float or quotes.
- [ ] **Shared address.** Proposed chat.robbooker.com with branded community redirects; not configured.

## Live

- [x] LB Main, Social and admin-only SHORTSCOUT with separate history/access.
- [x] Room-specific LB/SS header, compact settings menu and appearance choices.
- [x] Required Longboard login, linked member identities and private-message requests/inbox.
- [x] Keyword and semantic Search tab with source context; background indexing of Main/Social only.
- [x] Searchable GIPHY picker in the + menu.
- [x] Palm reactions beside timestamps.
- [x] Enter to send; Shift+Enter for a new line.
- [x] Member mention autocomplete.
- [x] Open chat at the newest messages.

## Released in PR236

- [x] SHORTSCOUT burgundy/rose palette across Dark, Light and Blade Runner themes; capitalized room labels.

## Pending room-label update

- [ ] Compact room labels: **LB**, **SOCIAL**, **SS**, including the locked SS tab and search labels. URL slugs and history stay unchanged.
