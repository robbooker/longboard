// The search-jump fixture on this test's own ports, without #301's migration: the test seeds
// nested replies the way production has them, then applies the migration through /test/exec.
process.env.CHAT_FIXTURE_PORT||='54591';process.env.CHAT_APP_PORT||='3391';
process.env.CHAT_FIXTURE_DEFER_MIGRATIONS='20261023120000_chat_single_level_replies.sql';
await import('./chat-search-jump-fixture.mjs');
