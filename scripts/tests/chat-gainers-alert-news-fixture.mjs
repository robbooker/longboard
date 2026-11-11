// #436 Latest press release under a stock's first Gainers alert: the search-jump fixture (every
// migration, /test/sql and /test/identity) on this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54623';process.env.CHAT_APP_PORT||='3423';
await import('./chat-search-jump-fixture.mjs');
