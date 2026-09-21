'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

async function atomicWrite(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'w', 0o600);
    await handle.writeFile(JSON.stringify(state));
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temporary, file);
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (handle) await handle.close();
    await fs.rm(temporary, { force: true });
  }
}

function type(value) { return value?.['@type'] || value?._; }
function compare(a, b) {
  return Date.parse(a.payload.postedAt) - Date.parse(b.payload.postedAt) || a.payload.sourceMessageId - b.payload.sourceMessageId;
}

async function createRelay({ stateFile, sourceChannelId, activationAt, destination, token,
  fetchImpl = globalThis.fetch, writeState = atomicWrite, now = Date.now, report = () => {}, timeoutMs = 15000 }) {
  if (!/^-?\d+$/.test(sourceChannelId) || !Number.isSafeInteger(Number(sourceChannelId))) throw new Error('Invalid source channel');
  const activation = Date.parse(activationAt);
  if (!Number.isFinite(activation)) throw new Error('Invalid activation time');
  const url = new URL(destination);
  if (url.protocol !== 'https:' || url.pathname !== '/api/chat/gainers/ingest' || url.search || url.hash || url.username || url.password) throw new Error('Invalid destination');
  if (typeof token !== 'string' || token.length < 32) throw new Error('Ingestion token must contain at least 32 characters');
  const identity = { sourceChannelId, activationAt: new Date(activation).toISOString(), destination: url.href };
  let state;
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state) {
    if (state.version !== 1 || JSON.stringify(state.identity) !== JSON.stringify(identity) || !state.items || !state.rejected) throw new Error('State identity or format mismatch; refusing to reset');
  } else {
    state = { version: 1, identity, items: {}, rejected: {}, acceptedWatermark: null };
    await writeState(stateFile, state);
  }
  let deliveryStopped;
  let serial = Promise.resolve(), delivering = false, catchingUp = false, recoveryComplete = false, timer, stopped = false;
  const locked = fn => {
    const next = serial.then(fn);
    serial = next.catch(() => {});
    return next;
  };
  async function change(fn) {
    const draft = structuredClone(state);
    const result = fn(draft);
    try { await writeState(stateFile, draft); }
    catch (error) { recoveryComplete = false; report({ event: 'state-write-failure', recoveryRequired: true }); throw error; }
    state = draft;
    return result;
  }
  async function accept(message) {
    if (String(message.chat_id) !== sourceChannelId || message.date * 1000 < activation) return 'ignored';
    const id = message.id;
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(message.date)) throw new Error('Invalid source message identity');
    const content = message.content;
    const body = type(content) === 'messageText' ? content.text?.text : content?.caption?.text;
    return locked(async () => {
      if (state.items[id]) return 'duplicate';
      if (typeof body !== 'string' || !body.trim() || Array.from(body).length > 4096) {
        if (state.rejected[id]) return 'unsupported';
        await change(draft => { draft.rejected[id] = { sourceMessageId: id, reason: 'Unsupported media, empty caption, or oversized text', postedAt: new Date(message.date * 1000).toISOString() }; });
        report({ event: 'unsupported', sourceMessageId: id });
        return 'unsupported';
      }
      const payload = { sourceChannelId, sourceMessageId: id, postedAt: new Date(message.date * 1000).toISOString(), body };
      if (Buffer.byteLength(JSON.stringify(payload)) > 32768) throw new Error('Payload exceeds byte limit');
      await change(draft => {
        draft.items[id] = { payload, status: 'pending', attempts: 0, nextAttemptAt: 0 };
        if (!draft.acceptedWatermark || id > draft.acceptedWatermark) draft.acceptedWatermark = id;
        delete draft.rejected[id];
      });
      return 'queued';
    });
  }
  // Re-scan to immutable activation on every recovery. A high-water ID alone can
  // skip history arriving concurrently with live updates or TDLib cache filling.
  async function catchUp(invoke) {
    if (catchingUp) throw new Error('Catchup already running');
    catchingUp = true; recoveryComplete = false;
    try {
      let cursor = 0;
      const cursors = new Set();
      for (;;) {
        const page = await invoke({ _: 'getChatHistory', chat_id: Number(sourceChannelId), from_message_id: cursor, offset: 0, limit: 100, only_local: false });
        if (!Array.isArray(page.messages)) throw new Error('Invalid Telegram history response');
        if (!page.messages.length) break;
        let crossedActivation = false;
        for (const message of page.messages) {
          await accept(message);
          if (message.date * 1000 < activation) crossedActivation = true;
        }
        if (crossedActivation) break;
        const next = Math.min(...page.messages.map(m => m.id));
        if (!Number.isSafeInteger(next) || next <= 0 || next === cursor || cursors.has(next)) throw new Error('Telegram history pagination stalled; retry recovery');
        cursors.add(next); cursor = next;
      }
      recoveryComplete = true;
    } finally { catchingUp = false; }
  }
  async function tick() {
    if (delivering || catchingUp || !recoveryComplete || stopped) return;
    delivering = true;
    try {
      for (;;) {
        const item = await locked(() => Object.values(state.items).filter(x => x.status === 'pending').sort(compare)[0]);
        if (!item || item.nextAttemptAt > now() || catchingUp || !recoveryComplete || stopped) return;
        let status = 0, retryAfter = 0;
        try {
          const response = await fetchImpl(url.href, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(item.payload), signal: AbortSignal.timeout(timeoutMs) });
          status = response.status;
          const header = response.headers?.get('retry-after');
          if (header) retryAfter = /^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - now());
          await response.body?.cancel();
        } catch { /* Do not log request objects, URLs, or credentials. */ }
        const terminal = status >= 400 && status < 500 && ![401, 403, 408, 425, 429].includes(status);
        const success = status >= 200 && status < 300;
        await locked(() => change(draft => {
          const current = draft.items[item.payload.sourceMessageId];
          current.attempts += 1;
          current.lastStatus = status;
          current.status = success ? 'delivered' : terminal ? 'quarantined' : 'pending';
          current.nextAttemptAt = now() + Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, Math.min(300000, 1000 * 2 ** Math.min(current.attempts, 8)));
        }));
        report({ event: success ? 'delivered' : terminal ? 'quarantined' : [401, 403].includes(status) ? 'authentication-failure' : 'retry', sourceMessageId: item.payload.sourceMessageId, status });
        if (!success && !terminal) return;
      }
    } finally { delivering = false; deliveryStopped?.(); deliveryStopped = undefined; }
  }
  function start() {
    if (timer) return;
    stopped = false;
    timer = setInterval(() => tick().catch(() => report({ event: 'state-write-failure' })), 1000);
    timer.unref?.();
  }
  function stop() { stopped = true; clearInterval(timer); timer = null; return delivering ? new Promise(resolve => { deliveryStopped = resolve; }) : Promise.resolve(); }
  return { accept, catchUp, tick, start, stop, snapshot: () => structuredClone(state),
    onUpdate: update => type(update) === 'updateNewMessage' ? accept(update.message) : Promise.resolve('ignored') };
}
module.exports = { createRelay, atomicWrite };
