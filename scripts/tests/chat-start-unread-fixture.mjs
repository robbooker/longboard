// Current published chat SQL/auth fixture, synthetic accounts and localhost only.
process.env.CHAT_FIXTURE_PORT||='54573';
process.env.CHAT_APP_PORT||='3373';
await import('./chat-social-label-fixture.mjs');
