# Chat — running feature list

Updated September 16, 2026.

## Direction agreed

**One chat app with many rooms.** Each community can retain its own branding and verified membership rules. Shared Social and webinar rooms fit within the same application. Longboard and paid ShortScout membership login/account linking are live. LB members access LB/SOCIAL; paid SS members access SS/SOCIAL; linked members can switch across all three. The app currently lives at www.longboardai.com/chat; ShortScout /chat redirects there. A shared branded domain is still planned.

## Next — first build priority

- [ ] **Attachments in the + menu.** Proposed first version: images and PDFs, upload progress, previews and private room-authorized downloads. Include pasting an image from the clipboard directly into the chat composer. See [attachment architecture](chat-attachments.md). Not implemented.

## Built locally — awaiting review and release

- [x] **Reply to Comments — implementation complete; awaiting review and release.** Focused mobile reply view, original comment/composer/indented replies, nested conversation navigation, browser Back/Forward and explicit Back/Close, retained per-comment drafts and room scroll state, reduced-motion-aware transitions. Approved request `3259d476-f14d-479c-ab0d-b9b992512179`. See [mobile reply verification](chat-mobile-replies.md).

- [x] **Desktop view — implementation complete; awaiting release.** Desktop room sidebar, central chat, conditional right reply panel, theme-based own-message backgrounds and same-window navigation. Member replies validate room and parent access and preserve existing rate limits. Narrow screens use a focused fallback panel. Approved request `8b1b7705-41c9-462b-83dc-1859caa45849`. The separate mobile Reply to Comments implementation is listed above; full thread counts remain outside this release.

- [x] **DM and mention counts — implementation complete; awaiting release.** Combined chat bell with separate counts, room badges, private previews, opening conversations and individual/all read actions. Existing DM read markers remain authoritative; mention edits/deletions and snapshot cutoffs preserve accurate counts. Approved request `9ee67300-5e29-47bf-9999-dce9b6a2c727`.
- [x] **SUMMARIZER — implementation complete; awaiting release.** `/summary [room]` sends a concise latest-50-message recap to the requesting member’s private assistant inbox. Ten-minute cache, content-based invalidation, generation lease, cooldown and room/account checks. Approved request `24eff61a-83e6-493c-9cba-5145b470d1e4`.

- [x] **Approve merge & publish — implementation complete; awaiting release.** Owner-only button with explicit confirmation tied to the PR and commit version. Durable publishing queue, worker claim, stale-approval rejection, failure reconfirmation and verified completion. Requested directly by Rob.

- [x] **Notification Alerts — implementation complete; awaiting release.** Optional browser-local sound setting and test chime in the private feature notification inbox. Initial unread history, repeated polling and read alerts remain silent; new unread arrivals chime once per fetched batch. Approved request `cf9242fa-90ca-4f7a-95f6-e6e82d09cc3e`.

- [x] **See Likes — implementation complete; awaiting release.** Hover or focus a palm reaction to see up to ten active liker display names, with a more indicator and empty state. Room-authorized lookup, current reaction refresh and Escape dismissal. Approved request `e1d1c459-b052-4a03-b8fa-397d3c14d2da`.

- [x] **Feature-section light/dark theme — implementation complete; awaiting release.** Header toggle switches the feature page and its notification inbox immediately, remembers the choice locally, and leaves other app themes unchanged. Approved request `54414ebd-5103-499d-a408-ea75c8974093`.

- [x] **Mobile feature-channel layout — implementation complete; awaiting release.** Shrink-safe content grid, wrapping title/author/timestamp rows, responsive request cards and mobile form controls keep discussions and proposals within the viewport. Approved request `e754a623-e97a-47eb-8037-6c9389d66ea6`.

- [x] **Feature status glow — implementation complete; awaiting release.** Pending discussions/approved requests glow white, active work blue, ready/published work red. Explicit status labels distinguish awaiting pickup, working, review and published. Reduced-motion users get steady highlighting. Visible-page status refresh every two seconds; no reload needed. Approved request `9c5155cc-9afc-4901-82e4-cf87e69c15d6`.

- [x] **Chat login appearance — implementation complete; awaiting release.** Membership chooser and chat-entry Longboard credential form use the Crash site’s peach, brick red, dark ink, Barlow Condensed and DM Sans styling. Responsive membership cards, visible keyboard focus and styled authentication errors; existing login destinations preserved. Approved request `c66c73df-4145-4e88-953a-e24f1a15c926`.

- [x] **Date stamps on chat comments — implementation complete; awaiting release.** Compact local `[Sep 16 | 13:35]` timestamps in room messages, private messages, feature discussions and search/context results; full date/year/timezone on hover. Approved request `31740362-5ca6-4380-a010-dd9bc20b85a8`.

- [ ] **Members edit or delete their own messages.** Enforce ownership on the server; offer message actions with an edited indicator and deletion confirmation. Keep displayed history and search/vector results consistent with edits and deletions. Implemented locally with database permission and browser checks; not published.
- [ ] **Admins delete room messages.** Add moderation actions for authorized chat admins, with confirmation and an audit record. Apply deletion consistently to history, search/vector results, and future attachments. This does not grant admins new access to private DMs. Implemented locally; not published.

## Planned

- [ ] **In-chat image and TradingView previews.** Clicking a pasted image or TradingView chart link opens an in-app preview panel or overlay instead of a separate browser tab, keeping the conversation in view. Images use a larger viewer; investigate TradingView embedding support and provide a clear fallback for links that cannot be embedded. Preserve room access checks for private attachments. Planning only; not implemented.

- [ ] **Typing indicators (typing bubbles).** Show “Rob is typing…” or animated dots while members compose a message. Room-scoped and visible only to authorized participants; short-lived signals that clear after sending, inactivity or disconnect. Do not transmit draft text or store typing events in message history. Planning only; not implemented.

- [ ] **Personal settings.** Font choices and related display preferences.
- [ ] **Search refinements.** Improve relevance, add date filters and consider topic windows.
- [ ] **Embedded webinars + event rooms.** Replace the command2 video placeholder with a member-authorized player alongside the already integrated shared chat. Each event gets a room, recording/transcript links and searchable chat. Choose technology after confirming the current host tool, audience participation and acceptable delay. See [webinar plan](chat-webinars.md).
- [ ] **Phone app chat.** Bring the shared experience into the authenticated phone app.
- [ ] **More + menu additions.** Stickers and stock cards such as float or quotes.
- [ ] **Shared address.** Move the same app to chat.robbooker.com, with Longboard and ShortScout entry points redirecting to the relevant room. Update fixed login callback/origin URLs and verify cross-domain sign-in/cookies as part of the move. No separate rooms or message databases are needed. Not configured.
- [x] **PROMPT ALIGN — implementation complete; awaiting release.** Focus the DM composer on open/reopen or conversation switch without stealing focus on refresh. Feature-channel discussion messages implicitly address Codex; regular DMs remain private. Approved request `598895b5-9bc2-4dc4-914e-cf16ba6a8705`.


## Live

- [x] LB, SOCIAL and SS with separate room permissions/history; paid ShortScout login and explicit account linking released in Longboard PR238 and ShortScout PR90. Rob confirmed paid login on the published site.
- [x] Room-specific LB/SS header, compact settings menu and appearance choices.
- [x] Required membership login, linked member identities and private-message requests/inbox.
- [x] Keyword and semantic Search tab with source context; background indexing of Main/Social only.
- [x] Searchable GIPHY picker in the + menu.
- [x] Palm reactions beside timestamps.
- [x] Enter to send; Shift+Enter for a new line.
- [x] Member mention autocomplete.
- [x] Open chat at the newest messages.

## Released in PR236

- [x] SHORTSCOUT burgundy/rose palette across Dark, Light and Blade Runner themes; capitalized room labels.

## Released in PR237

- [x] Compact room labels: **LB**, **SOCIAL**, **SS**, including the locked SS tab and search labels. URL slugs and history stay unchanged.
