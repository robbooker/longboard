// #439 tags follow the person through name changes: the search-jump fixture (current schema,
// /test/sql and /test/exec) on this test's own ports, without #439's migration. The test seeds
// tags the way production has them (a name in the text only), renames members, then applies the
// migration through /test/exec and checks the backfill. Synthetic data only.
// #537's Webinars rooms (20261127130000) are left out too: that migration first checks that the
// functions it replaces are current, and record_chat_room_mentions is not until #439's is applied.
process.env.CHAT_FIXTURE_PORT||='54639';process.env.CHAT_APP_PORT||='3439';
process.env.CHAT_FIXTURE_DEFER_MIGRATIONS=[process.env.CHAT_FIXTURE_DEFER_MIGRATIONS,'20261111120000_chat_tags_follow_person.sql','20261111170000_chat_merge_linked_profiles.sql','20261127130000_chat_webinars_room.sql'].filter(Boolean).join(',');
await import('./chat-search-jump-fixture.mjs');
