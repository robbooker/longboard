// Current published synthetic schema; no live accounts or credentials.
process.env.CHAT_FIXTURE_PORT||='54572';
process.env.CHAT_APP_PORT||='3372';
await import('./chat-social-label-fixture.mjs');
