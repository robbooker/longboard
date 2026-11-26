// #528 Gainer Balloons: the search-jump fixture (current schema, /test/sql and /test/identity) on
// this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54528';process.env.CHAT_APP_PORT||='3528';
await import('./chat-search-jump-fixture.mjs');
