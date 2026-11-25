// #500: going into a room lands on its main conversation, never inside a reply thread. A thread
// open in one room closes when another room is chosen, and coming back to the first room shows its
// main conversation again, even when an unread reply waits in the thread the reader had open (the
// room's oldest unread used to open that thread). On a computer and on a phone. Links to a reply
// (?thread=, as push notifications use, and #chat-message-<reply>, as the bell uses) still open
// that thread. Run with the shared chat fixture (chat-mobile-fixture.mjs).
// Exclusively synthetic local accounts and data.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { signIn } from './browser-login.mjs';
const base = 'http://localhost:3502', fixture = 'http://127.0.0.1:54702/rest/v1/';
const scale = Number(process.env.CHAT_TIMING_SCALE) || 1;
const shots = process.env.ROOM_SWITCH_SHOTS || '/tmp';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function rest(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(fixture + path, { method, headers: { authorization: 'Bearer test-service-role', 'Content-Type': 'application/json', prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json(); assert.ok(r.ok, JSON.stringify(d)); return d;
}
const [bob] = await rest('longboard_chat_members?select=id&display_name=eq.Bob');
const alice = '00000000-0000-4000-8000-000000000001';
const post = async (room, body, replyTo) => (await rest('longboard_chat_messages', { room_slug: room, member_id: bob.id, guest_id: bob.id, author_label: 'Bob', body, ...(replyTo ? { reply_to_id: replyTo } : {}) }))[0];
async function readAll(room) {
  const [top] = await rest(`longboard_chat_messages?select=unread_seq&room_slug=eq.${room}&order=unread_seq.desc&limit=1`);
  const updated = await rest(`chat_room_reads?account_id=eq.${alice}&room_slug=eq.${room}`, { through_seq: top.unread_seq }, 'PATCH');
  if (!updated.length) await rest('chat_room_reads', { account_id: alice, room_slug: room, through_seq: top.unread_seq });
}
const ROOMS = { main: 'LB', social: 'Social' };
const log = (label) => `[role="log"][aria-label="${label} messages"]`;
const thread = 'aside[aria-label="Comment replies"]';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  for (const device of ['desktop', 'phone']) {
    // Each room has a conversation with replies; everything so far is read.
    const lbRoot = await post('main', `LB conversation (${device})`);
    await post('main', `LB first reply (${device})`, lbRoot.id);
    const socialRoot = await post('social', `Social conversation (${device})`);
    await post('social', `Social first reply (${device})`, socialRoot.id);
    for (const room of ['main', 'social']) await readAll(room);

    const context = await browser.createBrowserContext();
    const page = await context.newPage(); page.setDefaultTimeout(30000 * scale);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await signIn(page, base, 'alice@example.test', { composer: 'textarea[aria-label="Message LB"]' });
    const phone = device === 'phone';
    if (phone) await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    else await page.setViewport({ width: 1440, height: 1000 });
    const shown = (e) => !!e && e.getClientRects().length > 0;
    const ready = (label) => page.waitForSelector(`${log(label)}:not([data-positioning]) [id^="chat-message-"]`, { visible: true });
    const threadShown = () => page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0), thread);
    const threadParent = () => page.$eval(`${thread} [aria-label="Original comment"]`, (e) => e.dataset.threadMessageId);
    const tap = async (selector) => {
      await page.waitForSelector(selector, { visible: true });
      await page.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0).click(), selector);
    };
    const to = async (slug) => {
      if (phone) {
        // A phone shows one screen at a time: close the thread, back to the list, tap the room.
        if (await threadShown()) { await tap(`${thread} button[aria-label="Close replies"]`); await page.waitForFunction((s) => ![...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0), {}, thread); }
        await tap('button[aria-label="Back to all chats"]'); await pause(300);
      }
      await tap(`nav a[href*="room=${slug}"]`);
      await ready(ROOMS[slug]); await pause(1200 * scale);
    };
    const openThread = async (label, root) => {
      await tap(`${log(label)} #chat-message-${root} button[data-has-replies]`);
      await page.waitForSelector(`${thread} #thread-reply`, { visible: true });
      assert.equal(await threadParent(), root, `${device}: the chosen conversation is open`);
    };
    const expectMain = async (label, why) => {
      await pause(1500 * scale);
      assert.equal(await threadShown(), false, `${device} ${why}: no reply thread on screen`);
      assert.ok(await page.$eval(log(label), shown), `${device} ${why}: ${label} main conversation on screen`);
    };

    await page.goto(base + '/chat?room=main'); await ready('LB');
    if (phone && !(await page.$eval(log('LB'), shown))) await to('main');
    // Opening and replying in a thread within one room works as before.
    await openThread('LB', lbRoot.id);
    await page.type('#thread-reply', `Alice replies in LB (${device})`);
    await page.keyboard.press('Enter');
    await page.waitForFunction((s, t) => [...document.querySelectorAll(`${s} [data-thread-message-id] p`)].some((e) => e.textContent === t), {}, thread, `Alice replies in LB (${device})`);
    console.log(`PASS ${device}: a thread opens in LB and takes a reply.`);

    // 1. Room B has an unread reply in a thread: choosing it shows its main conversation.
    const socialUnread = await post('social', `Unread Social reply (${device})`, socialRoot.id);
    await to('social');
    await page.screenshot({ path: `${shots}/chat-room-switch-main-${device}.png` });
    await expectMain('Social', 'LB thread -> Social');
    assert.ok(await page.$(`${log('Social')} #chat-message-${socialRoot.id}`), `${device}: the conversation with the unread reply is in the list`);
    console.log(`PASS ${device}: with a thread open in LB, choosing Social shows Social's main conversation (its unread reply waits in its thread).`);

    // Its thread still opens on request, at the unread reply.
    await openThread('Social', socialRoot.id);
    await page.waitForSelector(`${thread} [data-thread-message-id="${socialUnread.id}"]`, { visible: true });
    console.log(`PASS ${device}: Social's thread opens on request and shows the unread reply.`);

    // 2. Back to LB, where a reply arrived in the thread Alice had open: LB's main conversation.
    await post('main', `Unread LB reply (${device})`, lbRoot.id);
    await to('main');
    await expectMain('LB', 'back to LB');
    console.log(`PASS ${device}: back in LB, the main conversation shows, not the thread open last time.`);

    // 3. A link to a thread (push notifications: ?thread=<conversation>) still opens it.
    await page.goto(`${base}/chat?room=social&thread=${socialRoot.id}`);
    await page.waitForSelector(`${thread} #thread-reply`, { visible: true });
    assert.equal(await threadParent(), socialRoot.id, `${device}: ?thread= opens that conversation`);
    console.log(`PASS ${device}: a ?thread= link opens that thread.`);

    // 4. A link to one reply (the bell: #chat-message-<reply>) opens its thread at that reply.
    const linked = await post('main', `Linked LB reply (${device})`, lbRoot.id);
    await page.goto(`${base}/chat?room=main#chat-message-${linked.id}`);
    await page.waitForSelector(`${thread} [data-thread-message-id="${linked.id}"]`, { visible: true });
    assert.equal(await threadParent(), lbRoot.id, `${device}: the reply link opens its conversation`);
    console.log(`PASS ${device}: a link to a reply opens its thread at that reply.`);

    assert.deepEqual(errors, [], `${device}: no page errors`);
    await context.close();
  }
} finally { await browser.close(); }
