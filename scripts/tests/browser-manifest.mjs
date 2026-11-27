// Which fixture and settings each chat browser test needs. Read by run-browser-tests.mjs. (chat-posting-links-quad- and chat-quad-advance-browser.mjs are
// checks that chat-skip-latest imports with --posting-links / --quad-advance; see its variants.)
//
// Every entry is a scripts/tests/<name>-browser.mjs file. Defaults, when a field is left out:
//   fixture  <name>-fixture.mjs when it exists, otherwise 'shared' (chat-mobile-fixture.mjs on the
//            test's own ports). 'none' runs the test on its own (it builds its own page).
//   app      the first localhost:3xxx port in the test; the Next dev server listens there.
//   db       the first 127.0.0.1:5xxxx port in the test, otherwise app + 51200; the fixture's port.
//   preload  <name>-preload.mjs when it exists (loaded into the Next server with --import).
//   env      preset names from PRESETS, added to the Next server's environment.
//   portEnv  pass CHAT_FIXTURE_PORT/CHAT_APP_PORT to the fixture (default: when the test names its db port).
//   weight   seconds on CI, used to balance shards (default: browser-weights.json, else 45).
//   timeout  seconds before the test is stopped (default 240).
//   variant/args  run the same test file again with these arguments, reported as <name>:<variant>.
//   sharedEnv     extra environment for both the fixture and the test.
//   clock    'HH:MM': the fixture, the Next server, the test and every page it opens start at the next
//            weekday's HH:MM in New York, whatever time the run really is (#499, test-clock.mjs). The
//            clock still ticks. #525: every test that reads "today" in New York has one (9:00 AM, so
//            alerts seeded minutes or hours back are still today), and it works beside a preload.
// quarantine: '<reason>' runs the test and reports it, but a failure does not fail the check.
// retired:    '<reason>' the test is not run.
// Every value here is synthetic; no production key ever belongs in this file.

export const PRESETS = {
  attachments: {
    TRANSLOADIT_KEY: 'test-key', TRANSLOADIT_SECRET: 'test-secret', CHAT_TEST_SCANNER: 'isolated-fixture',
    NEXT_PUBLIC_GIPHY_API_KEY: 'test-key', require: './scripts/tests/chat-attachments-scanner-fixture.cjs',
  },
  voice: {
    TRANSLOADIT_KEY: 'test-key', TRANSLOADIT_SECRET: 'test-secret', CHAT_TEST_SCANNER: 'isolated-fixture',
    OPENAI_API_KEY: 'test-key', require: './scripts/tests/chat-voice-provider-fixture.cjs',
  },
  scanner: { TRANSLOADIT_KEY: 'test-key', TRANSLOADIT_SECRET: 'test-secret', CHAT_TEST_SCANNER: 'isolated-fixture' },
  openai: { OPENAI_API_KEY: 'test-key' },
  cron: { CRON_SECRET: 'synthetic-local-cron' },
  // The typing test answers the page's Ably socket itself; no real Ably is reached.
  ably: { CHAT_ABLY_API_KEY: 'fake.key:secret', CHAT_ABLY_ROLLOUT: 'all' },
  // EVENT-STREAM step 1: numbered room events and the catch-up endpoint.
  eventStream: { CHAT_EVENT_STREAM: 'all' },
  // D-212: the closed bell reads its numbers from chat_activity_counters.
  bellCounters: { CHAT_BELL_COUNTERS: 'all' },
  membership: { CHAT_MEMBERSHIP_EXPORT_KEY: 'synthetic-test-key-never-a-production-secret' },
  // #338: the tokens Marketing HQ uses for the FAQ suggestions feed and review (synthetic).
  // #340: the token the nightly gainers job uses (synthetic).
  gainersDaily: { CHAT_GAINERS_DAILY_TOKEN: 'synthetic-gainers-daily-token-never-a-production-secret' },
  // #341: the Runner Risk Watch sender's secret (synthetic).
  runnerWatch: { CHAT_RUNNER_WATCH_TOKEN: 'synthetic-runner-watch-token-never-a-production-secret' },
  // #371: the token the Gainers Table lookup program uses (synthetic).
  gainersLookup: { CHAT_GAINERS_LOOKUP_TOKEN: 'synthetic-gainers-lookup-token-never-a-production-secret' },
  // #372: a key for the Gainers Table's snapshot; chat-gainers-table-preload.mjs answers Polygon (synthetic).
  polygon: { POLYGON_API_KEY: 'synthetic-polygon-key-never-a-production-secret' },
  // #458: a key for Short Check's overseas feed; chat-gainers-nexus-preload.mjs answers it (synthetic).
  shortCheck: { SHORT_CHECK_API_KEY: 'synthetic-short-check-key-never-a-production-secret' },
  faqReview: { CHAT_FAQ_SUGGESTIONS_READ_TOKEN: 'synthetic-faq-read-token-never-a-production-secret', CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN: 'synthetic-faq-write-token-never-a-production-secret' },
  // #302: the What's New poster's shared secret (synthetic).
  whatsNew: { WHATS_NEW_TOKEN: 'synthetic-whats-new-token-never-a-production-secret' },
  // #384: Stripe's webhook secret and a test key; chat-members-join-preload.mjs answers Stripe and Resend (synthetic).
  members: {
    STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_members_test_secret_never_real', STRIPE_SECRET_KEY: 'sk_test_synthetic_never_a_real_key',
    RESEND_API_KEY: 're_synthetic_never_a_real_key', MEMBERS_FROM_EMAIL: 'Booker Stock Club <club@example.test>',
  },
  // #502: made-up LiveKit settings; LIVEKIT_URL is chat-stage-video-browser.mjs's own stand-in on this machine.
  livekit: { LIVEKIT_URL: 'ws://127.0.0.1:54633', LIVEKIT_API_KEY: 'APIsyntheticNeverReal', LIVEKIT_API_SECRET: 'synthetic-livekit-secret-never-a-production-secret' },
  // #509: the same made-up LiveKit settings, pointed at chat-stage-phone-browser.mjs's own stand-in.
  livekitPhone: { LIVEKIT_URL: 'ws://127.0.0.1:54643', LIVEKIT_API_KEY: 'APIsyntheticNeverReal', LIVEKIT_API_SECRET: 'synthetic-livekit-secret-never-a-production-secret' },
  // #386: the Booker Stock Club cron runs at any hour in the test (ignored in a production build).
  stockClub: { STOCK_CLUB_ANY_HOUR: '1' },
};

export const TESTS = [
  { name: 'chat-action-menu-dismiss', fixture: 'none' },
  { name: 'chat-activity-trace', retired: 'Needs a hand-made app/trace-test page that must never be committed (docs/chat-activity-trace.md); nothing to run it against.' },
  { name: 'chat-announcement-likes' },
  { name: 'chat-announcements' },
  { name: 'chat-api-tokens', fixture: 'none' },
  { name: 'chat-approvals-top' },
  { name: 'chat-archive-controls' },
  { name: 'chat-archive-order' },
  { name: 'chat-attachment-only', fixture: 'chat-shortscout-authorization-fixture.mjs', env: ['attachments'] },
  { name: 'chat-attachments', env: ['attachments'] },
  { name: 'chat-attachments-shortscout', app: 3204, env: ['attachments'] },
  { name: 'chat-auto-scroll' },
  { name: 'chat-avatars' },
  { name: 'chat-boardroom-access' },
  { name: 'chat-bootstrap', retired: 'A benchmark comparing two production builds (before/after), not a pass/fail check of one build.' },
  { name: 'chat-clipboard', fixture: 'none' },
  // #457: chat admins post in Booker Stock Club; members stay read-only.
  { name: 'chat-club-admin-posts', timeout: 300 },
  // #535: the club's chat opens to members while a webinar is live there; LiveKit and Ably are stand-ins inside the test.
  // About 90s here (it waits out the real 20 seconds after a broadcast stops, twice over with a short drop).
  { name: 'chat-club-webinar-chat', env: ['ably', 'livekit'], timeout: 600, weight: 200 },
  { name: 'chat-ai-insights', timeout: 300 },
  { name: 'chat-delete-replies' },
  { name: 'chat-device-store' },
  { name: 'chat-dm-alignment', env: ['attachments'] },
  { name: 'chat-dm-copy' },
  { name: 'chat-dm-directory' },
  { name: 'chat-dm-header' },
  { name: 'chat-dm-media', env: ['attachments'] },
  { name: 'chat-dm-html', env: ['attachments'] },
  { name: 'chat-dm-message-actions' },
  { name: 'chat-dm-open-reads' },
  { name: 'chat-dm-previews' },
  { name: 'chat-dm-send-focus' },
  { name: 'chat-dm-sidebar' },
  { name: 'chat-dm-sound' },
  { name: 'chat-dm-spacing' },
  { name: 'chat-early-typing' },
  { name: 'chat-edit-approved' },
  { name: 'chat-enter-replies' },
  { name: 'chat-event-stream', env: ['ably', 'eventStream'], timeout: 420 },
  // About 270-360s of test on CI (its quiet windows are 6s there and it switches rooms ~25 times,
  // and it waits out the five-minute stream confirm): a 300s budget left slow runners short (#359).
  { name: 'chat-stream-switch-reads', preload: 'chat-event-stream-preload.mjs', env: ['ably', 'eventStream'], timeout: 720 },
  { name: 'chat-favorite' },
  { name: 'chat-feature-archive', retired: 'An older copy of the first half of chat-archive-controls, which runs the same archive flow plus paging and search.' },
  { name: 'chat-feature-card-layout' },
  { name: 'chat-feature-colors' },
  { name: 'chat-features-link' },
  { name: 'chat-pages' },
  // #529 Booker Tube: chat-video-picks-preload.mjs answers YouTube's feeds; the daily job runs with the synthetic cron secret.
  { name: 'chat-video-picks', env: ['cron'], timeout: 480 },
  // #441: the address bar follows the page on screen (?page=<name>), with Back between pages and rooms.
  { name: 'chat-page-urls', timeout: 360 },
  { name: 'chat-page-link-saves' },
  { name: 'chat-page-link-poster' },
  { name: 'chat-page-link-saves-unapplied', sharedEnv: { CHAT_FIXTURE_DEFER_MIGRATIONS: '20261030230000_chat_page_link_saves_reactions.sql,20261031090000_chat_private_link_poster.sql' } },
  { name: 'chat-faq', env: ['openai', 'faqReview'] },
  { name: 'chat-faq-collapse' },
  { name: 'chat-improvement-suggestions' },
  { name: 'chat-feature-notice-banner' },
  { name: 'chat-feature-priority' },
  { name: 'chat-feature-priority-notice' },
  { name: 'chat-gainers', fixture: 'none' },
  // #419: every Gainers alert shows its own small time and date; other rooms keep their grouping.
  { name: 'chat-gainers-alert-time', clock: '09:00' },
  // #436: the latest press release under a stock's first alert, posted through the lookup route.
  // #499: at 9:00 AM New York on a weekday, so its alerts always fall in today's Eastern day.
  { name: 'chat-gainers-alert-news', env: ['gainersLookup'], clock: '09:00' },
  { name: 'chat-members-join', env: ['members'], timeout: 360 },
  // #390: the welcome email and one-tap sign-in; the same fake Stripe and Resend as chat-members-join.
  { name: 'chat-members-welcome', preload: 'chat-members-join-preload.mjs', env: ['members'], timeout: 360 },
  { name: 'chat-gainers-table', env: ['gainersLookup', 'polygon'], timeout: 360, clock: '09:00' },
  // #476: the heading as one slim "About this table" bar; reuses the Gainers Table's fake Polygon.
  // #528: Gainer Balloons (the app and the Dual, Quad and Six card), with a fake Polygon (chat-gainer-balloons-preload.mjs).
  { name: 'chat-gainer-balloons', env: ['gainersLookup', 'polygon'], timeout: 900, clock: '09:00' },
  { name: 'chat-gainers-heading', preload: 'chat-gainers-table-preload.mjs', env: ['gainersLookup', 'polygon'], timeout: 360, clock: '09:00' },
  // #458: the overseas marker beside a "US" block, from a fake Short Check (chat-gainers-nexus-preload.mjs).
  { name: 'chat-gainers-nexus', env: ['gainersLookup', 'polygon', 'shortCheck'], timeout: 300, clock: '09:00' },
  // #386: Booker Stock Club; chat-stock-club-preload.mjs answers Polygon (synthetic).
  { name: 'chat-stock-club', env: ['cron', 'gainersLookup', 'polygon', 'stockClub'], timeout: 360, clock: '09:00' },
  // #378: the Terminal theme on a room, the Gainers Table and the FAQ; reuses the Gainers Table's fake Polygon.
  { name: 'chat-terminal-theme', preload: 'chat-gainers-table-preload.mjs', env: ['gainersLookup', 'polygon'], timeout: 360, clock: '09:00' },
  // #501: stage mode (admin-only preview); its stock panel reads the Gainers Table through the same fake Polygon.
  { name: 'chat-stage-mode', preload: 'chat-gainers-table-preload.mjs', env: ['gainersLookup', 'polygon'], timeout: 360, clock: '09:00' },
  // #502: live video in stage mode, open to members; LiveKit is a stand-in inside the test, and the stock panel reads the Gainers Table through the same fake Polygon.
  // #509: the phone's viewing room for a live room (video, and the room chat on a button); LiveKit is a stand-in inside the test.
  { name: 'chat-stage-phone', env: ['livekitPhone'], timeout: 780, weight: 210 },
  // #522: longer since the test also waits out the half minute before the server closes an ended room, twice.
  { name: 'chat-stage-video', preload: 'chat-gainers-table-preload.mjs', env: ['livekit', 'gainersLookup', 'polygon'], timeout: 900, clock: '09:00' },
  // #507: the host sets the stock on screen for everyone; LiveKit, Ably and Polygon are all stand-ins (its own preload has the last two).
  { name: 'chat-stage-on-screen', env: ['ably', 'livekit', 'gainersLookup', 'polygon'], timeout: 360, clock: '09:00' },
  // #508: Raise hand for everyone watching; LiveKit (the room's participants and their attributes) is a stand-in inside the test.
  { name: 'chat-stage-hand', preload: 'chat-gainers-table-preload.mjs', env: ['livekit', 'gainersLookup', 'polygon'], timeout: 360 },
  // #524: webinar notices (Booker Stock Club, the recording on the ended notice); LiveKit is a stand-in inside the test.
  { name: 'chat-stage-notice', env: ['livekit'], timeout: 420, weight: 150 },
  { name: 'chat-header-cards' },
  { name: 'chat-jammie-admin' },
  { name: 'chat-jammie-approval' },
  { name: 'chat-jumping' },
  // #477: Latest grays out while the newest message is on screen (rooms, DMs, threads, phone, themes).
  { name: 'chat-latest-grayed', fixture: 'none' },
  { name: 'chat-list-anchor' },
  // #473: Earlier/Newer messages leave the reader's message where it is (room, DM, thread; phone and computer).
  // #520: Latest stays usable after another request takes over from it; Show sent message retries by itself.
  { name: 'chat-latest-stuck' },
  { name: 'chat-load-keeps-place', timeout: 360 },
  { name: 'chat-membership-alignment' },
  { name: 'chat-membership-badges', fixture: 'none' },
  { name: 'chat-membership-records', fixture: 'chat-membership-alignment-fixture.mjs', preload: false, env: ['membership'],
    testNodeOptions: '--import ./scripts/tests/chat-membership-export-preload.mjs' },
  { name: 'chat-menu-settle' },
  // #444: one chat profile per person (the test seeds a linked pair and merges it).
  { name: 'chat-merge-linked-profiles' },
  { name: 'chat-message-reactions' },
  { name: 'chat-message-reactions-voice', fixture: 'chat-message-reactions-fixture.mjs', env: ['voice'] },
  { name: 'chat-mobile' },
  { name: 'chat-mobile-header' },
  { name: 'chat-mobile-keyboard' },
  { name: 'chat-mobile-keyboard-observer', fixture: 'none' },
  { name: 'chat-mobile-reaction-details', fixture: 'none' },
  { name: 'chat-mobile-send', fixture: 'none' },
  // #438: several chats popped out at once, each in its own titled window.
  { name: 'chat-multiple-popouts', timeout: 360 },
  { name: 'chat-name-apostrophes' },
  { name: 'chat-nav-width' },
  { name: 'chat-nested-reply-counts' },
  { name: 'chat-notification-formatting', fixture: 'none' },
  { name: 'chat-notification-formatting-live', fixture: 'chat-notification-formatting-fixture.mjs', db: 54553, portEnv: true },
  { name: 'chat-notification-list' },
  { name: 'chat-notification-list-hook', fixture: 'none' },
  { name: 'chat-notification-filters', fixture: 'none' },
  { name: 'chat-notification-order', fixture: 'none' },
  { name: 'chat-notification-unread-first', fixture: 'none' },
  { name: 'chat-notification-order-live', fixture: 'chat-social-label-fixture.mjs', preload: 'chat-social-label-preload.mjs' },
  { name: 'chat-notification-order-live', variant: 'bell-counters', fixture: 'chat-social-label-fixture.mjs', preload: 'chat-social-label-preload.mjs', env: ['bellCounters'], sharedEnv: { CHAT_BELL_COUNTERS_EXPECTED: '1' } },
  { name: 'chat-offline-outbox' },
  { name: 'chat-phone-nav' },
  { name: 'chat-phone-landing' },
  { name: 'chat-phone-notifications', fixture: 'none' },
  { name: 'chat-phone-notify-prompt' },
  // #414: the larger picture view; it uses the profile-picture fixture (uploads, the public bucket).
  { name: 'chat-picture-view', fixture: 'chat-avatars-fixture.mjs' },
  { name: 'chat-pinned-message-jump' },
  { name: 'chat-pinned-unread' },
  { name: 'chat-sidebar-fold' },
  { name: 'chat-column-resize' },
  { name: 'chat-photo-next', env: ['attachments'], timeout: 300 },
  { name: 'chat-pins' },
  { name: 'chat-polls', env: ['ably'] },
  { name: 'chat-posting-links', fixture: 'none' },
  { name: 'chat-profile-owner', fixture: 'none' },
  { name: 'chat-push-settings', fixture: 'none' },
  { name: 'chat-quad', fixture: 'none' },
  // #492/#493: Dual view (two panes) on a desktop, an open and a closed folding phone.
  { name: 'chat-dual', fixture: 'none' },
  { name: 'chat-six', fixture: 'none' },
  // #470/#474: drag the edge beside a Six card to resize that card only (the other row stays); double-click puts it back; saved per account, Reset widths, phone unchanged.
  { name: 'chat-six-widths', fixture: 'none' },
  // #506: a Dual, Quad or Six view card that is just a room's live video; LiveKit is a stand-in inside the test.
  { name: 'chat-video-card', fixture: 'none' },
  // #407: the theme control and Terminal in Quad and Six (cards, headers, DMs).
  { name: 'chat-multiview-theme', fixture: 'none' },
  // #420: themes and colour combinations in Profile settings (its own fixture: chat-look-fixture.mjs).
  { name: 'chat-look', timeout: 360 },
  // #434: the ShortScout rooms follow the theme and colour combination (its own fixture: chat-ss-theme-fixture.mjs).
  { name: 'chat-ss-theme', timeout: 360 },
  { name: 'chat-quad-pin-collapse' },
  { name: 'chat-quick-switch' },
  { name: 'chat-reaction-footer', retired: 'Checks the palm/lemon reaction footer (#259), which the message reaction picker replaced; the picker is covered by chat-message-reactions, chat-announcement-likes and chat-mobile-reaction-details.' },
  { name: 'chat-reaction-timeout', fixture: 'none' },
  { name: 'chat-reactions-review', fixture: 'none' },
  { name: 'chat-recordings' },
  // #513: click-to-play YouTube/Loom cards in the recordings rooms (video hosts are intercepted, never reached).
  { name: 'chat-recordings-player', fixture: 'chat-recordings-fixture.mjs', portEnv: true },
  { name: 'chat-refresh', fixture: 'none' },
  { name: 'chat-reply-counts-hook', fixture: 'none' },
  { name: 'chat-reply-notifications' },
  { name: 'chat-reply-on-replies' },
  { name: 'chat-grouped-actions' },
  { name: 'chat-reply-path' },
  { name: 'chat-return-message', fixture: 'chat-recordings-fixture.mjs', portEnv: true },
  { name: 'chat-rob-reaction', fixture: 'none' },
  { name: 'chat-room-members-no-count', fixture: 'none' },
  { name: 'chat-room-members-sort', fixture: 'none' },
  { name: 'chat-room-message-pins' },
  { name: 'chat-room-message-pins-hook', fixture: 'none' },
  { name: 'chat-room-notify' },
  // Before the room-levels migration the setting stays hidden and nothing errors.
  { name: 'chat-room-notify', variant: 'premigration', sharedEnv: { ROOM_NOTIFY_PREMIGRATION: '1' } },
  { name: 'chat-room-scroll', fixture: 'none' },
  // #500: choosing a room lands on its main conversation, not a reply thread.
  { name: 'chat-room-switch-main', timeout: 360 },
  // #496: no Postgres room watch while Ably is live; hidden tabs drop their channels.
  { name: 'chat-room-watch', env: ['ably'] },
  { name: 'chat-room-unread' },
  { name: 'chat-s03-dm', fixture: 'chat-s03-fixture.mjs', env: ['attachments'] },
  { name: 'chat-s03-dm-intro', fixture: 'chat-s03-fixture.mjs' },
  { name: 'chat-s03-reply', fixture: 'chat-s03-fixture.mjs' },
  { name: 'chat-s04-dm', fixture: 'chat-s04-fixture.mjs' },
  { name: 'chat-s04-dm-identity', fixture: 'chat-s04-fixture.mjs' },
  { name: 'chat-s04-room', fixture: 'chat-s04-fixture.mjs' },
  { name: 'chat-s05-attachments', fixture: 'chat-s05-fixture.mjs', env: ['attachments'] },
  { name: 'chat-s05-image-bounds', fixture: 'chat-s05-fixture.mjs', env: ['attachments'] },
  { name: 'chat-s05-media-size', fixture: 'chat-s05-fixture.mjs', env: ['attachments'] },
  { name: 'chat-s05-room-attachments', fixture: 'chat-s05-fixture.mjs', env: ['attachments'] },
  { name: 'chat-s06-dialogs', fixture: 'none' },
  { name: 'chat-s06-render', retired: 'A render benchmark against a fixed old commit (5f30f42) that rewrites docs/chat-s06-render-results.md; not a pass/fail check.' },
  { name: 'chat-s07-panels', db: 54478 },
  { name: 'chat-s07-pedro', fixture: 'none' },
  { name: 'chat-screenshot-view', env: ['attachments'] },
  { name: 'chat-search-jump' },
  { name: 'chat-self-identification' },
  { name: 'chat-self-identification-component', fixture: 'none' },
  { name: 'chat-shortscout-authorization' },
  { name: 'chat-shell-keep', env: ['attachments'] },
  { name: 'chat-signal-recovery', fixture: 'chat-recordings-fixture.mjs', db: 54545, portEnv: true },
  { name: 'chat-single-replies' },
  { name: 'chat-skip-latest', fixture: 'none' },
  // The same Quad fixture, plus the checks kept in chat-quad-advance- and chat-posting-links-quad-browser.mjs.
  { name: 'chat-skip-latest', variant: 'quad-advance', args: ['--quad-advance'], fixture: 'none' },
  { name: 'chat-skip-latest', variant: 'posting-links', args: ['--posting-links'], fixture: 'none' },
  { name: 'chat-social-label' },
  { name: 'chat-ss-link', fixture: 'none' },
  { name: 'chat-ss-search', env: ['cron'] },
  { name: 'chat-start-unread' },
  // #439: tags follow the person through a name change; its fixture defers the migration, then the test applies it.
  { name: 'chat-tags-follow-person' },
  { name: 'chat-thread-edit' },
  { name: 'chat-thread-live-replies' },
  { name: 'chat-thread-mentions' },
  { name: 'chat-thread-menu' },
  { name: 'chat-ticket-delete' },
  { name: 'chat-timings' },
  // #468: the Trading Desk mock-up (owner only): its own page, route and sample data; no database.
  { name: 'chat-trading-desk', fixture: 'none', timeout: 300 },
  { name: 'chat-typing', env: ['ably'] },
  { name: 'chat-u01-header', db: 54478 },
  { name: 'chat-unread-dms-button' },
  { name: 'chat-unread-opening', fixture: 'none' },
  // Waits out up to five documented background refresh cycles (30-65 s each); takes 150-260 s on CI.
  { name: 'chat-user-name-updates', timeout: 420 },
  { name: 'chat-visible-notifications' },
  { name: 'chat-visible-observer', fixture: 'none' },
  { name: 'chat-voice', env: ['voice'] },
  { name: 'chat-whats-new', env: ['whatsNew'] },
  { name: 'chat-whats-new-pictures', fixture: 'chat-whats-new-fixture.mjs', env: ['whatsNew'] },
  // D-304: What's New? placement (below pins, above Rooms), name, description line, still read-only.
  { name: 'chat-whats-new-placement', fixture: 'chat-whats-new-fixture.mjs' },
  { name: 'chat-developers', fixture: 'chat-developers-fixture.mjs' },
  // #454: the sidebar's Developers link (Pages) for members with developer access.
  { name: 'chat-developers-link' },
  // #330: Wren, a bot account limited to Developers.
  { name: 'chat-bot-badge' },
  // #450: agents: made on the developers page, Agent badge and "run by", blocked rooms, mute, pause.
  { name: 'chat-agents', timeout: 420 },
  // #340: LB Review, its bot, the nightly job and the daily gainers page.
  { name: 'chat-lb-review', env: ['gainersDaily'], timeout: 420 },
  // #341: Runner Watch, its feed, its report page and the admin switches.
  { name: 'chat-runner-watch', env: ['runnerWatch'], timeout: 420 },
];
