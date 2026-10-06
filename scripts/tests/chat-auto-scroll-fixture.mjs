// Published synthetic SQL/Auth fixture; no production credentials or connections.
process.env.CHAT_FIXTURE_PORT||='54580';process.env.CHAT_APP_PORT||='3380';
await import('./chat-name-apostrophes-fixture.mjs');
