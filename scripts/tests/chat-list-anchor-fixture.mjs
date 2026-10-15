// Published synthetic SQL/Auth fixture; no production credentials or connections.
process.env.CHAT_FIXTURE_PORT||='54592';process.env.CHAT_APP_PORT||='3392';
await import('./chat-name-apostrophes-fixture.mjs');
