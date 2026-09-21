'use strict';
const { createRelay } = require('./gainers-relay.cjs');

// Attaches to the caller's already authenticated TDLib client. No client/session
// creation and no changes to other update listeners or destination filters.
async function attachGainers({ client, config, report = () => {}, repairMs = 300000,
  retryBaseMs = 1000, retryMaxMs = 300000, relayFactory = createRelay }) {
  if (!config) return { enabled: false, stop: async () => {}, recover: async () => {} };
  const safeReport = event => { try { report(event); } catch { /* logging must not lose updates */ } };
  const relay = await relayFactory({ ...config, report: event => { safeReport(event); if (event.recoveryRequired || event.event === 'state-write-failure') scheduleRetry(); } });
  let stopped = false, recovery = null, retryTimer, periodicTimer, attempts = 0;
  const pending = new Set();
  function track(promise) {
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }
  function scheduleRetry() {
    if (stopped || retryTimer) return;
    const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(attempts++, 16));
    retryTimer = setTimeout(() => { retryTimer = undefined; void recover(); }, delay);
    retryTimer.unref?.();
  }
  function recover() {
    if (stopped) return Promise.resolve();
    if (recovery) return recovery;
    clearTimeout(retryTimer); retryTimer = undefined;
    recovery = track(Promise.resolve().then(() => relay.catchUp(query => client.invoke(query)))
      .then(async () => { attempts = 0; await relay.tick(); })
      .catch(() => { safeReport({ event: 'recovery-failed' }); scheduleRetry(); })
      .finally(() => { recovery = null; }));
    return recovery;
  }
  function update(update) {
    if (stopped) return;
    track(Promise.resolve().then(() => relay.onUpdate(update)).catch(() => {
      safeReport({ event: 'update-write-failed' }); scheduleRetry();
    }));
    if (update?._ === 'updateConnectionState' && update.state?._ === 'connectionStateReady') void recover();
  }
  const reconnect = () => { void recover(); };
  client.on('update', update);
  client.on('ready', reconnect);
  relay.start();
  periodicTimer = setInterval(() => { void recover(); }, repairMs);
  periodicTimer.unref?.();
  // Listener is attached before the first history read.
  void recover();
  return { enabled: true, relay, recover, stop: async () => {
    stopped = true;
    clearTimeout(retryTimer); clearInterval(periodicTimer);
    client.removeListener('update', update); client.removeListener('ready', reconnect);
    await relay.stop();
    await Promise.allSettled([...pending]);
  } };
}
module.exports = { attachGainers };
