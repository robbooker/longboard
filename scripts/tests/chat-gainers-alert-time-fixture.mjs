// #419 Gainers alert time and date: the search-jump fixture (every migration, /test/sql and
// /test/identity) on this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54621';process.env.CHAT_APP_PORT||='3421';
await import('./chat-search-jump-fixture.mjs');
