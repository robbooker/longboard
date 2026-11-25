// #507 Stage mode, the stock on screen: the search-jump fixture (current schema, /test/sql and
// /test/identity) on this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54707';process.env.CHAT_APP_PORT||='3507';
await import('./chat-search-jump-fixture.mjs');
