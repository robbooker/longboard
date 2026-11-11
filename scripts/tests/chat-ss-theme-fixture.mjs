// #434 the ShortScout room follows the member's theme: the search-jump fixture (current schema,
// /test/sql, ShortScout rooms) on this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54634';process.env.CHAT_APP_PORT||='3434';
await import('./chat-search-jump-fixture.mjs');
