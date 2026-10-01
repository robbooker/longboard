// Actual composer components against synthetic API responses; no production data or credentials.
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const output = await mkdtemp(join(tmpdir(), 'posting-links-'));
const mocks = {
  'next/link': `import React from 'react';export default function Link({children,scroll,...props}){return <a {...props}>{children}</a>}`,
  'next/dynamic': `export default ()=>()=>null`,
  '@/lib/supabase/client': `const channel={on(){return this},subscribe(){return this},presenceState(){return{}},track(){}};const client={channel:()=>channel,removeChannel(){},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};export const createClient=()=>client;`,
};
await build({ entryPoints: ['scripts/tests/posting-links/entry.tsx'], outdir: output, bundle: true, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, loader: { '.woff2': 'dataurl' }, plugins: [{ name: 'fixture', setup(b) {
  b.onResolve({ filter: /^(next\/link|next\/dynamic|@\/lib\/supabase\/client)$/ }, a => ({ path: a.path, namespace: 'mock' }));
  b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents: mocks[a.path], loader: 'tsx', resolveDir: resolve('scripts/tests') }));
} }] });
const server = createServer(async (req, res) => {
  const file = req.url === '/entry.js' ? 'entry.js' : req.url === '/entry.css' ? 'entry.css' : null;
  res.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html');
  res.end(file ? await readFile(join(output, file)) : req.url.startsWith('/target') ? '<h1>Local link target</h1>' : '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/entry.css"></head><body style="margin:0"><div id="root"></div><script src="/entry.js"></script></body></html>');
});
await new Promise(r => server.listen(Number(process.env.POSTING_LINKS_PORT || 3350), '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const member = { id: '10000000-0000-4000-8000-000000000001', display_name: 'Alice', accepts_requests: true };
const other = '10000000-0000-4000-8000-000000000002', conversation = '20000000-0000-4000-8000-000000000001';
const message = { id: '30000000-0000-4000-8000-000000000001', guest_id: member.id, member_id: member.id, author_label: 'Alice', body: 'Original message', room_slug: 'main', created_at: '2026-10-01T12:00:00Z', attachment_ids: [], bot_slug: null, reply_to_id: null };
const direct = { ...message, sender_id: member.id, seq: 1, revision: 0, memberships: [] };
const preview = 'nav[aria-label="Links in your draft"]';
async function button(page, scope, text) {
  const found = await page.evaluate((scope, text) => { const button = [...document.querySelectorAll(`${scope} button`)].find(b => b.textContent.trim() === text); button?.click(); return !!button; }, scope, text);
  assert(found, 'Missing button ' + text);
}
async function replace(page, selector, text) {
  await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); if (text) await page.keyboard.sendCharacter(text);
}
try {
  for (const width of [1440, 390]) {
    const cases = [
      ...['room', 'quad-room', 'reply', 'dm', 'quad-dm', 'request', 'room-edit', 'dm-edit'].map(mode => ({ mode, room: 'main' })),
      ...['social', 'shortscout', 'lb-announcements', 'ss-announcements', 'lb-recordings', 'ss-recordings'].map(room => ({ mode: 'room', room })),
    ];
    for (const { mode, room } of cases) {
      const context = await browser.createBrowserContext();
      await context.overridePermissions(base, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
      const page = await context.newPage(); await page.setViewport({ width, height: 900, isMobile: width === 390, hasTouch: width === 390 });
      const errors = [], outsideRequests = [], sent = [];
      const readData = url => {
        if (url.pathname === '/api/chat/opening') return { messageId: null, readThrough: 1 };
        if (url.pathname === '/api/chat/thread') return { parent: message, replies: [], hasMore: false };
        if (url.pathname === '/api/chat/inbox') return url.searchParams.has('conversation') ? { messages: [direct], hasMore: false, hasNewer: false } : { conversations: [{ id: conversation, status: 'accepted', incoming: false, otherId: other, otherName: 'Bob', blockedByMe: false, unavailable: false, unread: 0, lastBody: 'Original message', updatedAt: message.created_at }] };
        if (url.pathname === '/api/chat/activity') return { roomCounts: {}, roomThrough: {}, roomMessageCounts: {}, roomMessageThrough: {}, dmCount: 0, dmThrough: 0, mentionCount: 0, mentionThrough: 0, dms: [], items: [], mentions: [], replies: [], replyCount: 0 };
        if (url.pathname === '/api/chat/bootstrap') return { accountId: 'account', room: url.searchParams.get('room'), member, roomState: { isOpen: true }, messages: [], reactions: [], counts: {}, featureChannel: false };
        if (url.pathname === '/api/chat/history') return { messages: [{ ...message, room_slug: room }], reactions: [] };
        if (url.pathname === '/api/chat') return { isOpen: true };
        return { counts: {}, reactions: [], conversations: [], messages: {}, members: [], items: [], pins: [], total: 1, isOwner: false };
      };
      page.on('pageerror', e => { errors.push(e.message); console.error(mode, width, e.stack); });
      await page.evaluateOnNewDocument(f => { window.fixture = f; }, { mode, room, member, message: { ...message, room_slug: room }, direct, conversation });
      await page.setRequestInterception(true);
      page.on('request', async request => {
        const url = new URL(request.url());
        if (url.origin !== base) { outsideRequests.push(request.url()); return request.abort(); }
        if (!url.pathname.startsWith('/api/')) return request.continue();
        const respond = body => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        const body = request.postData() ? JSON.parse(request.postData()) : {};
        if (['send', 'reply', 'request', 'edit'].includes(body.action)) { sent.push(body); return respond({ message: { ...(url.pathname.includes('inbox') ? direct : message), body: body.body, client_id: body.clientId }, conversationId: conversation }); }
        if (url.pathname === '/api/chat/updates') return respond({ results: body.paths.map(path => ({ path, status: 200, data: readData(new URL(path, base)) })) });
        return respond(readData(url));
      });
      await page.goto(base, { waitUntil: 'networkidle0' });
      if (mode === 'dm') { await page.waitForSelector('button'); await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Bob')).click()); }
      if (mode.includes('edit')) { await page.click('summary'); await button(page, 'details', 'Edit'); }
      const input = mode.includes('edit') ? 'dialog[open] textarea' : mode === 'reply' ? '#thread-reply' : mode.includes('dm') || mode === 'request' ? 'textarea[placeholder]' : 'textarea[aria-label^="Message "]';
      try { await page.waitForSelector(input); } catch (error) { console.error(await page.$eval('body', el => el.innerText)); await page.screenshot({ path: '/tmp/posting-links-failure.png' }); throw error; }
      await replace(page, input, '');
      assert.equal(await page.$(preview), null, mode + ': empty draft has no preview');
      await page.$eval(input, el => { window.composerNode = el; });
      await page.type(input, `Draft ${base}/target`);
      await page.waitForSelector(preview + ' a');
      assert.equal(await page.$eval(preview + ' a', el => el.href), base + '/target');
      assert.equal(await page.$eval(input, el => el === window.composerNode && document.activeElement === el && el.selectionStart === el.value.length), true, 'typing preserves input, focus and caret');
      assert(!(await page.$eval(preview, el => el.textContent)).includes('Draft'), 'preview must not duplicate whole draft');
      // Genuine OS clipboard paste carries HTML as well as plain text; textarea must keep plain text.
      const pasted = `Pasted https://www.tradingview.com/x/G4bHTjTX/\nhttps://media.giphy.com/media/abc/giphy.gif ${base}/target?x=1&y=2,`;
      await page.evaluate(async text => navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob(['<img src="https://hostile.test/pixel" onerror="window.attacked=true"><a href="javascript:alert(1)">Danger</a>'], { type: 'text/html' }) })]), pasted);
      await page.click(input); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.press('V'); await page.keyboard.up('Control');
      await page.waitForFunction((selector, text) => document.querySelector(selector)?.value === text, {}, input, pasted);
      assert.equal(await page.$$eval(preview + ' a', links => links.length), 3, 'multiline rich paste links');
      assert.equal(await page.$(preview + ' img'), null, 'no remote media previews');
      assert.equal(await page.evaluate(() => window.attacked), undefined);
      assert.deepEqual(outsideRequests, [], 'draft links never prefetch, fetch or load media');
      // Programmatic changes from input methods still travel through the normal input event.
      await replace(page, input, 'javascript:alert(1) data:text/html,<script>alert(1)</script> file:///tmp/foo https://%broken');
      await page.waitForFunction(selector => !document.querySelector(selector), {}, preview);
      await replace(page, input, `Long ${base}/target?value=${'a'.repeat(300)}`);
      await page.waitForSelector(preview);
      assert(await page.$eval(preview, el => el.scrollWidth <= el.clientWidth + 2), 'long URL wraps at mobile/quad widths');
      await page.screenshot({ path: `/tmp/posting-links-${mode}-${room}-${width}.png` });
      await replace(page, input, `Final ${base}/target`);
      await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
      assert.equal(sent.length, 0, 'Shift+Enter adds a line without sending');
      await page.$eval(input, el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
      assert.equal(sent.length, 0, 'composition Enter does not submit');
      await replace(page, input, `Final ${base}/target`);
      const attrs = await page.$eval(preview + ' a', el => ({ target: el.target, rel: el.rel, referrerPolicy: el.referrerPolicy }));
      assert.deepEqual(attrs, { target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' });
      const popupPromise = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Link did not open a new tab')), 5000); page.once('popup', popup => { clearTimeout(timer); resolve(popup); }); });
      if (width === 390) await page.tap(preview + ' a'); else await page.click(preview + ' a');
      const popup = await popupPromise;
      await popup.waitForSelector('h1'); assert.equal(await popup.evaluate(() => window.opener), null); await popup.close();
      assert.equal(await page.$eval(input, el => el.value), `Final ${base}/target`, 'click leaves draft intact');
      const keyboardPopup = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Keyboard link did not open a new tab')), 5000); page.once('popup', popup => { clearTimeout(timer); resolve(popup); }); });
      await page.focus(preview + ' a'); await page.keyboard.press('Enter');
      const opened = await keyboardPopup; await opened.waitForSelector('h1'); await opened.close();
      assert.equal(sent.length, 0, 'Enter on preview link never submits the composer');
      if (mode === 'room' && room === 'main') {
        await page.evaluate(() => document.querySelector('a[href="/chat?room=social"]').click());
        await page.waitForSelector('textarea[aria-label="Message SOCIAL"]');
        assert.equal(await page.$(preview), null, 'other room must not inherit preview');
        await replace(page, input, 'Other room https://example.org/other');
        await page.evaluate(() => document.querySelector('a[href="/chat?room=main"]').click());
        await page.waitForSelector('textarea[aria-label="Message LB"]');
        assert.equal(await page.$eval(input, el => el.value), `Final ${base}/target`, 'room switch restores original draft');
        assert.equal(await page.$eval(preview + ' a', el => el.href), base + '/target', 'restored preview follows only its room draft');
      }
      await page.click(input); await page.keyboard.press('Enter');
      await page.waitForFunction(selector => !document.querySelector(selector), {}, mode.includes('edit') ? 'dialog[open]' : preview);
      assert.equal(sent.length, 1, 'Enter sends/saves once'); assert.equal(sent[0].body, `Final ${base}/target`);
      assert.deepEqual(errors, [], 'browser exceptions');
      console.log(`PASS ${mode}/${room} ${width}: typing, rich paste, unsafe protocols, width, new tab, draft integrity, send/save`);
      await context.close();
    }
  }
} finally { await browser.close(); await new Promise(r => server.close(r)); await rm(output, { recursive: true, force: true }); }
