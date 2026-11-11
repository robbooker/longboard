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
  faqReview: { CHAT_FAQ_SUGGESTIONS_READ_TOKEN: 'synthetic-faq-read-token-never-a-production-secret', CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN: 'synthetic-faq-write-token-never-a-production-secret' },
  // #302: the What's New poster's shared secret (synthetic).
  whatsNew: { WHATS_NEW_TOKEN: 'synthetic-whats-new-token-never-a-production-secret' },
  // #384: Stripe's webhook secret and a test key; chat-members-join-preload.mjs answers Stripe and Resend (synthetic).
  members: {
    STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_members_test_secret_never_real', STRIPE_SECRET_KEY: 'sk_test_synthetic_never_a_real_key',
    RESEND_API_KEY: 're_synthetic_never_a_real_key', MEMBERS_FROM_EMAIL: 'Booker Stock Club <club@example.test>',
  },
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
  { name: 'chat-gainers-alert-time' },
  // #436: the latest press release under a stock's first alert, posted through the lookup route.
  { name: 'chat-gainers-alert-news', env: ['gainersLookup'] },
  { name: 'chat-members-join', env: ['members'], timeout: 360 },
  // #390: the welcome email and one-tap sign-in; the same fake Stripe and Resend as chat-members-join.
  { name: 'chat-members-welcome', preload: 'chat-members-join-preload.mjs', env: ['members'], timeout: 360 },
  { name: 'chat-gainers-table', env: ['gainersLookup', 'polygon'], timeout: 360 },
  // #386: Booker Stock Club; chat-stock-club-preload.mjs answers Polygon (synthetic).
  { name: 'chat-stock-club', env: ['cron', 'gainersLookup', 'polygon', 'stockClub'], timeout: 360 },
  // #378: the Terminal theme on a room, the Gainers Table and the FAQ; reuses the Gainers Table's fake Polygon.
  { name: 'chat-terminal-theme', preload: 'chat-gainers-table-preload.mjs', env: ['gainersLookup', 'polygon'], timeout: 360 },
  { name: 'chat-header-cards' },
  { name: 'chat-jammie-admin' },
  { name: 'chat-jammie-approval' },
  { name: 'chat-jumping' },
  { name: 'chat-list-anchor' },
  { name: 'chat-membership-alignment' },
  { name: 'chat-membership-badges', fixture: 'none' },
  { name: 'chat-membership-records', fixture: 'chat-membership-alignment-fixture.mjs', preload: false, env: ['membership'],
    testNodeOptions: '--import ./scripts/tests/chat-membership-export-preload.mjs' },
  { name: 'chat-menu-settle' },
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
  { name: 'chat-six', fixture: 'none' },
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
  { name: 'chat-typing', env: ['ably'] },
  { name: 'chat-u01-header', db: 54478 },
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
  // #330: Wren, a bot account limited to Developers.
  { name: 'chat-bot-badge' },
  // #340: LB Review, its bot, the nightly job and the daily gainers page.
  { name: 'chat-lb-review', env: ['gainersDaily'], timeout: 420 },
  // #341: Runner Watch, its feed, its report page and the admin switches.
  { name: 'chat-runner-watch', env: ['runnerWatch'], timeout: 420 },
];
