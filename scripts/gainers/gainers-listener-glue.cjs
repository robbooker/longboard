'use strict';
const path = require('node:path');
const { attachGainers } = require('./gainers-adapter.cjs');

async function attachConfiguredGainers({ client, channel, env = process.env,
  signals = process, log = console.log, attach = attachGainers,
  exit = code => process.exit(code) }) {
  if (env.CHAT_GAINERS_ENABLED !== '1') return null;
  const emit = data => { try { log(JSON.stringify({ component: 'chat-gainers', ...data })); } catch {} };
  try {
    const expected = env.CHAT_GAINERS_TELEGRAM_CHANNEL_ID;
    if (!expected || String(channel.id) !== expected) throw new Error('source mismatch');
    if (!path.isAbsolute(env.CHAT_GAINERS_STATE_FILE || '')) throw new Error('state path required');
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(env.CHAT_GAINERS_START_AT || '')) throw new Error('fixed UTC activation required');
    const handle = await attach({ client, config: {
      sourceChannelId: expected,
      activationAt: env.CHAT_GAINERS_START_AT,
      destination: env.CHAT_GAINERS_INGEST_URL,
      token: env.CHAT_GAINERS_INGEST_TOKEN,
      stateFile: env.CHAT_GAINERS_STATE_FILE,
    }, report: event => emit({ event: event.event, sourceMessageId: event.sourceMessageId, status: event.status }) });
    let shutdown;
    const close = () => {
      if (shutdown) return shutdown;
      signals.removeListener('SIGINT', interrupt);
      signals.removeListener('SIGTERM', terminate);
      shutdown = Promise.resolve().then(() => handle.stop());
      return shutdown;
    };
    const finish = code => {
      void close().then(() => client.close()).then(() => exit(code)).catch(() => {
        emit({ event: 'shutdown-failed' }); exit(1);
      });
    };
    const interrupt = () => finish(130);
    const terminate = () => finish(0);
    signals.once('SIGINT', interrupt); signals.once('SIGTERM', terminate);
    emit({ event: 'attached', sourceChannelId: String(channel.id), sourceTitle: String(channel.title || '') });
    return { stop: close };
  } catch {
    // Never print thrown configuration errors: they may include a credential or
    // malformed URL. Gainers disables itself; TraderRadio keeps running.
    emit({ event: 'disabled-invalid-configuration', sourceChannelId: String(channel.id), sourceTitle: String(channel.title || '') });
    return null;
  }
}
module.exports = { attachConfiguredGainers };
