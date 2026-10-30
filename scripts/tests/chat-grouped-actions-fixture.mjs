// #331: the search-jump fixture (every migration) on this test's own ports.
process.env.CHAT_FIXTURE_PORT||='54596';process.env.CHAT_APP_PORT||='3396';
await import('./chat-search-jump-fixture.mjs');
