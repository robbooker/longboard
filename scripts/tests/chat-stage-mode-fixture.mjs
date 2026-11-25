// #501 Stage mode: the search-jump fixture (current schema, /test/sql and /test/identity) on this
// test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54501';process.env.CHAT_APP_PORT||='3501';
await import('./chat-search-jump-fixture.mjs');
