'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachGainers } = require('./gainers-adapter.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
function stub(overrides = {}) {
  return { onUpdate: async () => {}, catchUp: async () => {}, tick: async () => {}, start() {}, stop() {}, ...overrides };
}
test('missing optional config does not attach or instantiate', async () => {
  const client = new EventEmitter();
  const adapter = await attachGainers({ client, relayFactory: () => { throw new Error('must not instantiate'); } });
  assert.equal(adapter.enabled, false); assert.equal(client.listenerCount('update'), 0); await adapter.stop();
});
test('attaches before catchup, handles live events, reconnect and cleans only own listeners', async () => {
  const client = new EventEmitter(), updates = []; let recoveries = 0, stops = 0;
  const other = () => {}; client.on('update', other);
  client.invoke = async q => q;
  const adapter = await attachGainers({ client, config: {}, relayFactory: async () => stub({ onUpdate: async u => updates.push(u), catchUp: async invoke => {
    assert.equal(client.listenerCount('update'), 2); recoveries++;
    assert.equal((await invoke({ _: 'getChatHistory' }))._, 'getChatHistory');
  }, stop: () => { stops++; } }) });
  await adapter.recover(); client.emit('update', { _: 'updateNewMessage' });
  await wait(5); client.emit('update', { _: 'updateConnectionState', state: { _: 'connectionStateReady' } });
  await wait(5); client.emit('ready'); await wait(5);
  assert.equal(recoveries, 3); assert.equal(updates.length, 2);
  await adapter.stop(); assert.equal(client.listenerCount('update'), 1); assert.equal(stops, 1);
  client.emit('ready'); await wait(5); assert.equal(recoveries, 3);
});
test('failed recovery and update callback retry; periodic repair; safe report callback', async () => {
  const client = new EventEmitter(); let count = 0;
  const adapter = await attachGainers({ client, config: {}, retryBaseMs: 2, retryMaxMs: 4, repairMs: 20,
    report: () => { throw new Error('logger failed'); }, relayFactory: async () => stub({ catchUp: async () => { if (++count === 1) throw new Error('offline'); }, onUpdate: async () => { throw new Error('disk full'); } }) });
  await wait(12); assert.ok(count >= 2);
  const before = count; client.emit('update', {}); await wait(12); assert.ok(count > before);
  await wait(25); assert.ok(count >= 4); await adapter.stop();
  const last = count; await wait(25); assert.equal(count, last);
});
test('shutdown awaits queued updates and outstanding recovery', async () => {
  const client = new EventEmitter(); let finish;
  const adapter = await attachGainers({ client, config: {}, relayFactory: async () => stub({ onUpdate: () => new Promise(r => { finish = r; }) }) });
  await adapter.recover(); client.emit('update', {}); await wait(1);
  let done = false; const stopping = adapter.stop().then(() => { done = true; });
  await wait(1); assert.equal(done, false); finish(); await stopping; assert.equal(done, true);
});
