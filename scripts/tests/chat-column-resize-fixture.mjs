// D-353 resizable chat columns: the search-jump fixture (current schema, /test/sql and /test/identity)
// on this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54563';process.env.CHAT_APP_PORT||='3363';
await import('./chat-search-jump-fixture.mjs');
