// #386 Booker Stock Club: the search-jump fixture (current schema, every migration, /test/sql) on
// this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54386';process.env.CHAT_APP_PORT||='3386';
await import('./chat-search-jump-fixture.mjs');
