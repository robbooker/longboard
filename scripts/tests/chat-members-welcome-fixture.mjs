// #390 club welcome email: the search-jump fixture (current schema, /test/sql) on this test's own
// ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54490';process.env.CHAT_APP_PORT||='3490';
await import('./chat-search-jump-fixture.mjs');
