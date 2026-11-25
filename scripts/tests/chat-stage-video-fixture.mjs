// #502 Stage mode's live video: the search-jump fixture (current schema, /test/sql and /test/identity)
// on this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54503';process.env.CHAT_APP_PORT||='3503';
await import('./chat-search-jump-fixture.mjs');
