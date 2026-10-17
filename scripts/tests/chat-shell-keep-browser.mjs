// SHELL-KEEP: the room left last stays mounted (hidden) so switching back is instant. Switching
// rooms again and again with a draft, an open thread and a pending attachment in each room must
// never carry anything from one room into the other: each room keeps its own draft, the thread
// closes, attachments are dropped (as before), only one room's list and composer show, a message
// sent after switching back lands in that room, and a room shown again picks up what it missed.
// Run with the shared chat fixture (chat-mobile-fixture.mjs) and the attachments preset.
// Exclusively synthetic local accounts and data.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = 'http://localhost:3397', fixture = 'http://127.0.0.1:54597/rest/v1/';
const scale = Number(process.env.CHAT_TIMING_SCALE) || 1;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function rest(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(fixture + path, { method, headers: { authorization: 'Bearer test-service-role', 'Content-Type': 'application/json', prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json(); assert.ok(r.ok, JSON.stringify(d)); return d;
}
await writeFile('/tmp/chat-shell-keep.pdf', '%PDF-1.4\nIsolated document fixture\n%%EOF');
const [bob] = await rest('longboard_chat_members?select=id&display_name=eq.Bob');
const start = Date.now() - 3600_000;
for (let i = 0; i < 30; i++) await rest('longboard_chat_messages', { room_slug: 'social', member_id: bob.id, guest_id: bob.id, author_label: 'Bob', body: `Shell social ${i + 1}`, created_at: new Date(start + i * 1000).toISOString() });
// Alice has read both rooms, so each switch opens at the newest message.
const alice = '00000000-0000-4000-8000-000000000001';
async function readAll(room) {
  const [top] = await rest(`longboard_chat_messages?select=unread_seq&room_slug=eq.${room}&order=unread_seq.desc&limit=1`);
  const updated = await rest(`chat_room_reads?account_id=eq.${alice}&room_slug=eq.${room}`, { through_seq: top.unread_seq }, 'PATCH');
  if (!updated.length) await rest('chat_room_reads', { account_id: alice, room_slug: room, through_seq: top.unread_seq });
}
for (const room of ['main', 'social']) await readAll(room);

const ROOMS = { main: 'LB', social: 'Social' };
const log = (label) => `[role="log"][aria-label="${label} messages"]`;
const composer = (label) => `textarea[aria-label="Message ${label}"]`;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(30000 * scale);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base + '/login?next=%2Fchat'); await page.waitForSelector('#li-email'); await page.reload({ waitUntil: 'networkidle0' });
  await page.type('#li-email', 'alice@example.test'); await page.type('#li-password', 'demo-only'); await page.click('button[type="submit"]');
  await page.waitForSelector(composer('LB'));
  await page.waitForFunction((s) => { const e = document.querySelector(s); return e && Object.keys(e).some((k) => k.startsWith('__reactProps$')); }, {}, composer('LB'));
  const ready = (label) => page.waitForSelector(`${log(label)}:not([data-positioning]) [id^="chat-message-"]`, { visible: true });
  // What is on screen: visible logs and composers, their drafts, attachments, the thread panel.
  const screen = () => page.evaluate(() => {
    const shown = (e) => !!e && e.getClientRects().length > 0;
    return {
      logs: [...document.querySelectorAll('[role="log"][aria-label$=" messages"]')].filter(shown).map((e) => e.getAttribute('aria-label')),
      composers: [...document.querySelectorAll('textarea[aria-label^="Message "]')].filter(shown).map((e) => [e.getAttribute('aria-label'), e.value]),
      attachments: [...document.querySelectorAll('ul[aria-label="Attachment drafts"] li')].filter(shown).map((e) => e.textContent),
      thread: shown(document.querySelector('aside[aria-label="Comment replies"]')),
    };
  });
  const to = async (slug) => {
    const link = `nav a[href*="room=${slug}"]`;
    await page.waitForSelector(link, { visible: true });
    await page.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0).click(), link);
    await ready(ROOMS[slug]); await pause(300);
  };
  const typeDraft = async (label, text) => {
    await page.click(composer(label), { clickCount: 3 }); await page.keyboard.press('Backspace');
    await page.type(composer(label), text);
  };
  const openThread = async (label) => {
    await page.evaluate((s) => [...document.querySelectorAll(`${s} article button`)].filter((b) => b.textContent.trim() === '↳ Reply').at(-1).click(), log(label));
    await page.waitForSelector('aside[aria-label="Comment replies"] #thread-reply', { visible: true });
  };
  const attach = async () => {
    const input = await page.$('input[type="file"][aria-label="Attach files"]');
    await input.uploadFile('/tmp/chat-shell-keep.pdf');
    await page.waitForFunction(() => [...document.querySelectorAll('ul[aria-label="Attachment drafts"] li')].some((e) => e.getClientRects().length > 0));
  };
  const expectRoom = async (label, draft, why) => {
    const s = await screen();
    assert.deepEqual(s.logs, [`${label} messages`], `${why}: one list on screen ${JSON.stringify(s)}`);
    assert.deepEqual(s.composers, [[`Message ${label}`, draft]], `${why}: one composer, this room's draft ${JSON.stringify(s)}`);
    assert.deepEqual(s.attachments, [], `${why}: no attachment carried over ${JSON.stringify(s)}`);
    assert.equal(s.thread, false, `${why}: no thread carried over`);
  };

  await ready('LB');
  // The page's first room view hydrates the server's HTML and is never kept; start from a room
  // opened by a switch.
  await to('social'); await to('main');
  // 1. LB: a draft, an open thread and a pending attachment.
  await typeDraft('LB', 'Draft for LB only'); await attach(); await openThread('LB');
  await page.type('#thread-reply', 'Thread draft for LB');
  const lbList = await page.$(log('LB'));
  await to('social');
  await expectRoom('Social', '', 'LB -> SOCIAL');
  console.log('PASS leaving LB (draft, thread, attachment) shows SOCIAL with none of them.');
  // 2. SOCIAL: its own draft, thread and attachment.
  await typeDraft('Social', 'Draft for SOCIAL only'); await attach(); await openThread('Social');
  await to('main');
  await expectRoom('LB', 'Draft for LB only', 'SOCIAL -> LB');
  assert.ok(await lbList.evaluate((e) => e.isConnected), 'LB was kept mounted: the same list is shown again');
  const gap = (label) => page.$eval(log(label), (e) => Math.round(e.scrollHeight - e.clientHeight - e.scrollTop));
  assert.ok((await gap('LB')) <= 2, 'LB opens again at the newest message');
  console.log('PASS back to LB shows the kept LB list with its own draft; no thread or attachment, at the newest message.');
  // 3. Switch back and forth; each room keeps its own draft, nothing else crosses.
  for (let i = 0; i < 6; i++) {
    const [slug, label, draft] = i % 2 ? ['main', 'LB', 'Draft for LB only'] : ['social', 'Social', 'Draft for SOCIAL only'];
    await to(slug); await expectRoom(label, draft, `switch ${i + 1} to ${label}`);
    if (i === 2) { await attach(); await openThread(label); }
  }
  console.log('PASS six more switches: each room keeps only its own draft; threads and attachments never cross.');
  // 4. The thread opens again in the room that is showing, and its reply goes to that room.
  await openThread('LB');
  await page.$eval('#thread-reply', (e) => e.value).then((v) => assert.ok(!v.includes('SOCIAL'), 'reply draft is LB\'s: ' + v));
  await page.click('button[aria-label="Close replies"]');
  // 5. A message sent after switching back lands in LB, not SOCIAL.
  await typeDraft('LB', 'Sent from LB after switching');
  await page.keyboard.press('Enter');
  await page.waitForFunction((s) => [...document.querySelectorAll(`${s} article`)].some((a) => a.textContent.includes('Sent from LB after switching') && !a.textContent.includes('Sending')), {}, log('LB'));
  // The row shows before the server has it (sending); wait for the stored message.
  let sent;
  for (let i = 0; i < 40 * scale && !sent; i++) {
    [sent] = await rest(`longboard_chat_messages?select=room_slug&body=eq.${encodeURIComponent('Sent from LB after switching')}`);
    if (!sent) await pause(250);
  }
  assert.ok(sent, 'the message reached the server');
  assert.equal(sent.room_slug, 'main', 'sent to LB');
  // 6. SOCIAL, kept hidden meanwhile, shows what arrived while it was away (newest at the bottom).
  const [me] = await rest('longboard_chat_members?select=id&display_name=eq.Alice');
  await rest('longboard_chat_messages', { room_slug: 'social', member_id: me.id, guest_id: me.id, author_label: 'Alice', body: 'Arrived in SOCIAL while away' });
  await readAll('social');
  await to('social');
  await page.waitForFunction((s) => [...document.querySelectorAll(`${s} article`)].some((a) => a.textContent.includes('Arrived in SOCIAL while away')), { timeout: 15000 * scale }, log('Social'));
  await expectRoom('Social', 'Draft for SOCIAL only', 'back to SOCIAL');
  assert.ok(!(await page.$$eval(`${log('Social')} article`, (rows) => rows.some((a) => a.textContent.includes('Sent from LB after switching')))), 'LB\'s message is not in SOCIAL');
  await pause(500); assert.ok((await gap('Social')) <= 2, 'SOCIAL at the newest message, gap ' + (await gap('Social')));
  console.log('PASS a message sent after switching lands in LB only; SOCIAL shown again picks up what arrived while away.');
  // 7. Browser back returns to LB with its draft (history still names the room).
  await page.goBack(); await ready('LB'); await pause(300);
  await expectRoom('LB', '', 'back button to LB');
  assert.deepEqual(errors, []);
  console.log('PASS back button returns to LB; no page errors.');
} finally { await browser.close(); }
