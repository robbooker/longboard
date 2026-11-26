// #489: the 30-second chat sign-in cache (lib/chatSessionCache.ts) is off in unit tests, so each
// test sees every request reach its mocked database. The cache's own tests turn it on.
process.env.CHAT_SESSION_CACHE = "off";
