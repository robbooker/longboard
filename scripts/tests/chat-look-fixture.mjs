// #420 themes and colour combinations: the search-jump fixture (current schema, /test/sql and
// /test/exec) on this test's own ports. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54620';process.env.CHAT_APP_PORT||='3420';
await import('./chat-search-jump-fixture.mjs');
