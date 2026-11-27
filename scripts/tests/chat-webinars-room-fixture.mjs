// #537 the Webinars room: the search-jump fixture (current schema, every migration, /test/sql) on
// this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54737';process.env.CHAT_APP_PORT||='3537';
await import('./chat-search-jump-fixture.mjs');
