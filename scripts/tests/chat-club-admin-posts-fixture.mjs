// #457 Booker Stock Club admin posts: the search-jump fixture (current schema, every migration,
// /test/sql) on this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54457';process.env.CHAT_APP_PORT||='3457';
await import('./chat-search-jump-fixture.mjs');
