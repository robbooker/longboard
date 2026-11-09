// #378 Terminal theme: the Gainers Table fixture (current schema, /test/sql and /test/identity) on this
// test's own ports, so the theme can be checked on a room, the Gainers Table and the FAQ. Synthetic data only.
process.env.CHAT_FIXTURE_PORT||='54388';process.env.CHAT_APP_PORT||='3388';
await import('./chat-search-jump-fixture.mjs');
