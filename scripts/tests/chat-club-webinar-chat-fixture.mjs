// #535 Booker Stock Club, chat during a webinar: the search-jump fixture (current schema, every
// migration, /test/sql) on this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54735';process.env.CHAT_APP_PORT||='3535';
await import('./chat-search-jump-fixture.mjs');
