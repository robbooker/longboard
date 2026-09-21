'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { attachConfiguredGainers } = require('./gainers-listener-glue.cjs');
const { patchSource, addition, anchor } = require('./make-listener-patch.cjs');
const env = { CHAT_GAINERS_ENABLED: '1', CHAT_GAINERS_TELEGRAM_CHANNEL_ID: '-100123', CHAT_GAINERS_STATE_FILE: '/private/outbox.json', CHAT_GAINERS_START_AT: '2026-09-21T19:00:00Z', CHAT_GAINERS_INGEST_URL: 'https://chat.robbooker.com/api/chat/gainers/ingest', CHAT_GAINERS_INGEST_TOKEN: 'fake-key-abcdefghijklmnopqrstuvwxyz' };
const channel = { id: -100123, title: 'Callz Stocks Gainers Alert' };
test('optional config no-op and mismatch/config failures do not throw or leak secrets', async () => {
  let attached = 0; const logs = [];
  const args = { client: {}, channel, env, attach: async () => { attached++; throw new Error(env.CHAT_GAINERS_INGEST_TOKEN); }, log: s => logs.push(s) };
  assert.equal(await attachConfiguredGainers({ ...args, env: {} }), null);
  assert.equal(await attachConfiguredGainers({ ...args, channel: { ...channel, id: -456 } }), null);
  assert.equal(attached, 0);
  assert.equal(await attachConfiguredGainers(args), null); assert.equal(attached, 1);
  assert.ok(!logs.join('').includes(env.CHAT_GAINERS_INGEST_TOKEN));
  assert.ok(logs.every(s => JSON.parse(s).event === 'disabled-invalid-configuration'));
});
test('actual resolved channel attaches with config; signal drains then closes same client', async () => {
  const signals = new EventEmitter(), actions = [], logs = [];
  const client = { close: async () => actions.push('client-close') };
  await attachConfiguredGainers({ client, channel, env, signals, log: s => logs.push(JSON.parse(s)), exit: n => actions.push(n), attach: async options => {
    assert.equal(options.client, client); assert.equal(options.config.sourceChannelId, String(channel.id));
    assert.equal(options.config.activationAt, env.CHAT_GAINERS_START_AT);
    return { stop: async () => actions.push('stop') };
  } });
  assert.equal(logs[0].sourceTitle, channel.title); assert.equal(logs[0].event, 'attached');
  signals.emit('SIGTERM'); await new Promise(r => setImmediate(r));
  assert.deepEqual(actions, ['stop', 'client-close', 0]); assert.equal(signals.listenerCount('SIGINT'), 0);
});
test('patch is insertion-only and preserves snapshot syntax and exact original bytes', () => {
  const snapshot = process.env.GAINERS_LISTENER_SNAPSHOT;
  const original = snapshot ? fs.readFileSync(snapshot, 'utf8') : 'const require = createRequire(import.meta.url);\nasync function main() {\n    if (dumpMessages) { return; }\n' + anchor + '\n      return;\n    }\n}\n';
  const patched = patchSource(original);
  assert.equal(patched.replace(addition, ''), original);
  assert.throws(() => patchSource(patched), /already installed/);
  assert.throws(() => patchSource(original + anchor), /anchors changed/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gainers-syntax-'));
  try {
    const file = path.join(dir, 'listener.mjs'); fs.writeFileSync(file, patched);
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('glue insertion does not require module or attach unless watch enabled', async () => {
  let calls = 0;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('watch', 'process', 'require', 'client', 'channel', addition);
  const load = () => ({ attachConfiguredGainers: async () => { calls++; } });
  await run(false, { env }, load, {}, channel); assert.equal(calls, 0);
  await run(true, { env: {} }, load, {}, channel); assert.equal(calls, 0);
  await run(true, { env }, load, {}, channel); assert.equal(calls, 1);
});
test('manual cleanup removes only Gainers signals and never closes shared Telegram client', async () => {
  const signals = new EventEmitter(), other = () => {}; let stopped = 0, closed = 0;
  signals.on('SIGTERM', other); signals.on('SIGINT', other);
  const handle = await attachConfiguredGainers({ client: { close: async () => { closed++; } }, channel, env, signals, log: () => {}, attach: async () => ({ stop: async () => { stopped++; } }) });
  await handle.stop(); await handle.stop();
  assert.equal(stopped, 1); assert.equal(closed, 0);
  assert.deepEqual(signals.listeners('SIGTERM'), [other]);
  assert.deepEqual(signals.listeners('SIGINT'), [other]);
});
