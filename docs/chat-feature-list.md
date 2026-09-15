# Longboard Chat — running feature list

Updated September 15, 2026. Add new chat requests here and update their status as work progresses.

## Planned

- [ ] **Personal settings: fonts and appearance.** Add a Settings menu item where each user can choose their preferred chat font and related display preferences. Exact options and menu placement remain to be decided. This extends the basic theme choices in the compact header; planning only, not implemented.

- [ ] **Attachments in the + menu.** Add an Attach file option beside GIF in the composer’s existing additions menu. Requested by Rob. File types, size limits, storage and download permissions still need to be defined. Not implemented.
- [ ] **Search refinements.** Evaluate relevance with real embeddings, add explicit date filters and consider topic windows as history grows.

## Built, awaiting release

- [ ] **LB Main + SHORTSCOUT admin preview.** Rename Main’s display label, add the admin-only SHORTSCOUT room and switch its header to SS ↘. Regular members see a locked tab; server/database permissions enforce access.

- [ ] **Semantic search.** Meaning + words, source context, background indexing, edit/delete handling, member search limits and private-message exclusion. Implemented and locally tested; production migration, backfill and real-provider relevance checks remain. See [setup plan](chat-search-setup.md).

- [ ] **Compact header and settings menu.** LB badge, visible Inbox, grouped appearance/admin/account/popout controls. [PR234](https://github.com/robbooker/longboard/pull/234).
- [ ] **Require Longboard login for chat.** Gate reading and posting while preserving existing history and linked member names. Included in [PR235](https://github.com/robbooker/longboard/pull/235).
- [ ] **Search tab with keyword search.** Search saved Main/Social messages, paginate results and open surrounding conversation. [PR235](https://github.com/robbooker/longboard/pull/235) also includes the compact header. Includes the first semantic search implementation.

## Later ideas

- [ ] **Universal membership chat.** Longboard and ShortScout spaces with verified membership access, shared Social, easy switching for dual members, and event-specific webinar rooms/transcripts. Proposed canonical address: chat.robbooker.com, with branded community redirects. Domains and cross-membership identity linking are not configured.

- [ ] **Phone app chat.** Bring authenticated chat into the phone app after the web experience is settled.
- [ ] **More + menu additions.** Stickers and stock information such as float or quotes were suggested; scope and priority remain undecided.

## Live

- [x] Main and Social rooms with separate history and room controls.
- [x] Linked member identities and private-message requests/inbox.
- [x] Searchable GIPHY picker in the + menu.
- [x] Palm reactions beside timestamps.
- [x] Enter to send; Shift+Enter for a new line.
- [x] Member mention autocomplete.
- [x] Open chat at the newest messages.
