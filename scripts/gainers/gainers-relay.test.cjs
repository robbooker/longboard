'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRelay, atomicWrite } = require('./gainers-relay.cjs');
const base = { sourceChannelId: '-1001234', activationAt: '2026-09-21T00:00:00.000Z', destination: 'https://chat.robbooker.com/api/chat/gainers/ingest', token: 'test-secret-abcdefghijklmnopqrstuvwxyz' };
const seconds = Date.parse(base.activationAt) / 1000;
const message = (id, body = `Alert ${id}`) => ({ id, chat_id: -1001234, date: seconds + id, content: { _: 'messageText', text: { text: body } } });
async function setup(t, extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gainers-relay-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const options = { ...base, stateFile: path.join(dir, 'outbox.json'), ...extra };
  return { relay: await createRelay(options), options };
}
const recover = relay => relay.catchUp(async () => ({ messages: [] }));
test('restart retains original payload; retry then duplicate source remains one delivery', async t => {
  let clock = 0; const bodies = []; let response = 503;
  const { relay, options } = await setup(t, { now: () => clock, fetchImpl: async (_, init) => { bodies.push(JSON.parse(init.body)); return { status: response }; } });
  await relay.accept(message(1, 'Original'));
  await recover(relay); await relay.tick();
  const restarted = await createRelay(options);
  assert.equal(await restarted.accept(message(1, 'Edited')), 'duplicate');
  response = 200; clock = 10000; await recover(restarted); await restarted.tick();
  assert.deepEqual(bodies.map(x => x.body), ['Original', 'Original']);
  assert.equal(restarted.snapshot().items[1].status, 'delivered');
  assert.ok(!(await fs.readFile(options.stateFile, 'utf8')).includes(base.token));
  assert.equal((await fs.stat(options.stateFile)).mode & 0o777, 0o600);
});
test('409 quarantines visibly while later alerts deliver; sends ordered', async t => {
  const sent = [], events = [];
  const { relay } = await setup(t, { report: x => events.push(x), fetchImpl: async (_, init) => { const id = JSON.parse(init.body).sourceMessageId; sent.push(id); return { status: id === 1 ? 409 : 201 }; } });
  await relay.accept(message(2)); await relay.accept(message(1));
  await relay.tick(); assert.deepEqual(sent, []);
  await recover(relay); await relay.tick();
  assert.deepEqual(sent, [1, 2]); assert.equal(relay.snapshot().items[1].status, 'quarantined');
  assert.ok(events.some(x => x.event === 'quarantined'));
});
test('429 retry pauses later delivery and honors Retry-After', async t => {
  let clock = 0, attempts = 0;
  const { relay } = await setup(t, { now: () => clock, fetchImpl: async () => { attempts++; return attempts === 1 ? { status: 429, headers: { get: () => '60' } } : { status: 200 }; } });
  await relay.accept(message(1)); await relay.accept(message(2)); await recover(relay);
  await relay.tick(); clock = 59000; await relay.tick(); assert.equal(attempts, 1);
  clock = 61000; await relay.tick(); assert.equal(attempts, 3);
});
test('pagination recovers more than 500 messages despite concurrent live updates', async t => {
  const { relay } = await setup(t);
  let calls = 0;
  await relay.catchUp(async request => {
    calls++;
    if (calls === 1) await relay.onUpdate({ _: 'updateNewMessage', message: message(605) });
    const top = request.from_message_id ? request.from_message_id - 1 : 605;
    return { messages: Array.from({ length: Math.min(100, top) }, (_, i) => message(top - i)) };
  });
  assert.equal(Object.keys(relay.snapshot().items).length, 605);
  assert.equal(relay.snapshot().acceptedWatermark, 605); assert.equal(calls, 8);
});
test('write failure never advances watermark or drops original queued item', async t => {
  let fail = false;
  const { relay, options } = await setup(t, { writeState: async (file, state) => { if (fail) throw new Error('disk full'); return atomicWrite(file, state); } });
  await relay.accept(message(1)); fail = true;
  await assert.rejects(relay.accept(message(2)), /disk full/);
  assert.equal(relay.snapshot().acceptedWatermark, 1);
  assert.equal(JSON.parse(await fs.readFile(options.stateFile)).acceptedWatermark, 1);
  fail = false; await relay.accept(message(2)); assert.equal(relay.snapshot().acceptedWatermark, 2);
});
test('delivery state write failure retries same payload after restart', async t => {
  let fail = false, sent = 0;
  const { relay, options } = await setup(t, { writeState: async (file, state) => { if (fail) throw new Error('disk full'); return atomicWrite(file, state); }, fetchImpl: async () => { sent++; return { status: 200 }; } });
  await relay.accept(message(1)); await recover(relay); fail = true;
  await assert.rejects(relay.tick(), /disk full/); fail = false;
  const next = await createRelay(options); await recover(next); await next.tick(); assert.equal(sent, 2);
});
test('immutable identity, captions, unsupported media, and activation boundary', async t => {
  const { relay, options } = await setup(t);
  await assert.rejects(createRelay({ ...options, activationAt: '2026-09-22' }), /mismatch/);
  assert.equal(await relay.accept({ ...message(1), date: seconds - 1 }), 'ignored');
  assert.equal(await relay.accept({ ...message(1), content: { _: 'messagePhoto', caption: { text: 'Photo caption' } } }), 'queued');
  assert.equal(await relay.accept({ ...message(2), content: { _: 'messagePhoto' } }), 'unsupported');
  assert.ok(relay.snapshot().rejected[2]);
});
test('stalled catchup fails closed; recovery can subsequently retry', async t => {
  let sent = 0;
  const { relay } = await setup(t, { fetchImpl: async () => { sent++; return { status: 200 }; } });
  await assert.rejects(relay.catchUp(async () => ({ messages: [message(1)] })), /stalled/);
  await relay.tick(); assert.equal(sent, 0);
  await recover(relay); await relay.tick(); assert.equal(sent, 1);
});
test('network errors retry safely and fetch forbids redirects with timeout', async t => {
  let called = 0;
  const { relay } = await setup(t, { fetchImpl: async (_, init) => {
    called++; assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    throw new Error('network unavailable');
  } });
  await relay.accept(message(1)); await recover(relay); await relay.tick();
  assert.equal(called, 1); assert.equal(relay.snapshot().items[1].status, 'pending');
  assert.equal(relay.snapshot().items[1].lastStatus, 0);
});
test('concurrent duplicate acceptance makes one durable entry', async t => {
  const { relay } = await setup(t);
  const results = await Promise.all(Array.from({ length: 20 }, () => relay.accept(message(1))));
  assert.equal(results.filter(x => x === 'queued').length, 1);
  assert.equal(Object.keys(relay.snapshot().items).length, 1);
});
test('auth failure preserves head and later queue until credentials repaired on restart', async t => {
  let clock = 0; const seen = [], events = [];
  const { relay, options } = await setup(t, { now: () => clock, report: e => events.push(e), fetchImpl: async (_, init) => { seen.push(JSON.parse(init.body).sourceMessageId); return { status: 401 }; } });
  await relay.accept(message(1)); await relay.accept(message(2)); await recover(relay); await relay.tick();
  assert.equal(relay.snapshot().items[1].status, 'pending'); assert.deepEqual(seen, [1]);
  assert.equal(events.at(-1).event, 'authentication-failure');
  clock = 10000;
  const restarted = await createRelay({ ...options, token: 'repaired-abcdefghijklmnopqrstuvwxyz', fetchImpl: async (_, init) => { seen.push(JSON.parse(init.body).sourceMessageId); return { status: 200 }; } });
  await recover(restarted); await restarted.tick(); assert.deepEqual(seen, [1, 1, 2]);
});
test('failed concurrent catchup stops sends after already in-flight request completes', async t => {
  let resolve, sent = 0;
  const { relay } = await setup(t, { fetchImpl: async () => { sent++; return new Promise(r => { resolve = r; }); } });
  await relay.accept(message(1)); await relay.accept(message(2)); await recover(relay);
  const running = relay.tick();
  while (!resolve) await new Promise(r => setImmediate(r));
  await assert.rejects(relay.catchUp(async () => { throw new Error('offline'); }));
  resolve({ status: 200 }); await running; assert.equal(sent, 1);
});
test('unsupported history repeat does not rewrite or report; later caption can queue', async t => {
  let writes = 0; const events = [];
  const { relay } = await setup(t, { writeState: async (...args) => { writes++; await atomicWrite(...args); }, report: e => events.push(e) });
  const media = { ...message(1), content: { _: 'messagePhoto' } };
  await relay.accept(media); const count = writes;
  await relay.accept(media); assert.equal(writes, count); assert.equal(events.length, 1);
  assert.equal(await relay.accept({ ...media, content: { _: 'messagePhoto', caption: { text: 'now supported' } } }), 'queued');
  assert.equal(relay.snapshot().rejected[1], undefined);
});
test('short credential rejected', async t => {
  await assert.rejects(setup(t, { token: 'short' }), /32/);
});
