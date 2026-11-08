// #384 club sign-up: the search-jump fixture (current schema, /test/sql) on this test's own ports.
// Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54384';process.env.CHAT_APP_PORT||='3384';
await import('./chat-search-jump-fixture.mjs');
