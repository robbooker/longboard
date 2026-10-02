// Current published chat SQL with synthetic local Auth/data only.
process.env.CHAT_FIXTURE_PORT||='54568';
process.env.CHAT_APP_PORT||='3368';
await import('./chat-social-label-fixture.mjs');
