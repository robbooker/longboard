// Published synthetic SQL/Auth fixture; no production credentials or connections.
process.env.CHAT_FIXTURE_PORT||='54720';process.env.CHAT_APP_PORT||='3520';
await import('./chat-social-label-fixture.mjs');
