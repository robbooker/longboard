// Existing current-schema synthetic fixture; no live accounts or credentials.
process.env.CHAT_FIXTURE_PORT||='54571';
process.env.CHAT_APP_PORT||='3371';
await import('./chat-social-label-fixture.mjs');
