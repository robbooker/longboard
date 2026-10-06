// Current published synthetic SQL/Auth fixture, including SS search; localhost only.
process.env.CHAT_FIXTURE_PORT||='54575';process.env.CHAT_APP_PORT||='3375';
await import('./chat-ss-search-fixture.mjs');
