// #444 one chat profile per person: the search-jump fixture (current schema, every migration,
// /test/sql) on this test's own ports. The test links Bob's Longboard account to the fixture's
// ShortScout account, gives that profile a second name of Bob's, and merges the pair. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54644';process.env.CHAT_APP_PORT||='3444';
await import('./chat-search-jump-fixture.mjs');
