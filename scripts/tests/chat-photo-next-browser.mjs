// #375: the open photo viewer steps to the next and previous photo of the same conversation view.
// A room with five photos over four messages (and one reply photo, which belongs to the thread, not
// the room). Desktop (dark) and phone (light, touch): open the second, Next shows the third and the
// label updates, the arrow keys step, a swipe steps (a two-finger pinch does not), there is no Next
// on the last and no Previous on the first, the neighbours are preloaded, the viewer is a top-layer
// modal that hit-tests its own buttons, and Escape closes it with focus back on a photo.
// The replies thread (desktop) has its own set: the parent's photo and the reply's.
//
// PHOTO_SHOTS=<dir> saves the viewer open on a middle photo (photo-next-desktop.png, -phone.png).
// PHOTO_BEFORE=<file> only opens the second photo on desktop and saves that screenshot (for a run
// against main, where the viewer has no steps).
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = 'http://localhost:3475';
const shots = process.env.PHOTO_SHOTS || '', before = process.env.PHOTO_BEFORE || '';
const sharp = (await import('sharp')).default;
const colors = ['#2f6f9f', '#9f4f2f', '#3f8f4f', '#7f3f8f', '#8f7f2f', '#2f8f8f'];
const photo = (n, label) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${colors[n - 1]}"/><text x="600" y="440" font-size="140" font-family="sans-serif" fill="#fff" text-anchor="middle">${label}</text></svg>`)).png().toBuffer();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const step = name => console.log('STEP', name);
const post = (page, url, body) => page.evaluate(async ({ url, body }) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }, { url, body });
async function upload(p, scope, bytes, name) { return p.evaluate(async ({ scope, base64, name }) => { const mime = 'image/png', bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); let r = await fetch('/api/chat/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, filename: name, mime_type: mime, byte_size: bytes.length }) }); const reserved = await r.json(); if (!r.ok) throw Error(JSON.stringify(reserved)); r = await fetch(reserved.url, { method: 'PUT', headers: { 'Content-Type': mime, 'x-upsert': 'false' }, body: bytes }); if (!r.ok) throw Error('upload failed'); r = await fetch('/api/chat/attachments/' + reserved.id, { method: 'POST' }); if (!r.ok) throw Error(await r.text()); return reserved.id; }, { scope, base64: bytes.toString('base64'), name }); }

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  step('seed the room');
  const setup = await browser.newPage(); await setup.setViewport({ width: 1440, height: 900 });
  await signIn(setup, base, 'alice@example.test', { composer: 'textarea[aria-label^="Message "]' });
  const send = async (body, files, replyTo) => { const clientId = randomUUID(); let r; for (let i = 0; i < 20; i++) { r = await post(setup, '/api/chat', { action: 'send', room: 'main', body, attachmentIds: files, clientId, ...(replyTo ? { replyTo } : {}) }); if (r.status !== 429) break; await sleep(3000); } assert.equal(r.status, 200, JSON.stringify(r)); await sleep(1600); return r.data.message.id; };
  const room = { room: 'main' }, ids = [];
  for (let n = 1; n <= 5; n++) ids.push(await upload(setup, room, await photo(n, `Photo ${n}`), `photo-${n}.png`));
  const first = await send('Photos from the morning: one', [ids[0]]);
  await send('Two more', [ids[1], ids[2]]);
  await send('Just text between the photos', []);
  await send('The fourth', [ids[3]]);
  await send('And the last one', [ids[4]]);
  const replyPhoto = await upload(setup, room, await photo(6, 'Reply photo'), 'reply-photo.png');
  await send('A photo in the replies', [replyPhoto], first);
  await setup.close();

  const viewer = 'dialog[open]';
  const state = p => p.evaluate(() => { const d = document.querySelector('dialog[open]'); if (!d) return null; const img = d.querySelector('img'); return { title: d.querySelector('h2')?.textContent, label: d.querySelector('[data-photo-position]')?.textContent ?? '', src: img?.getAttribute('src') ?? '', prev: !!d.querySelector('button[aria-label="Previous photo"]'), next: !!d.querySelector('button[aria-label="Next photo"]'), focusInside: d.contains(document.activeElement), modal: d.matches(':modal') }; });
  const expectAt = async (p, n, total = 5) => { await p.waitForFunction((n, total) => { const d = document.querySelector('dialog[open]'); return d?.querySelector('h2')?.textContent === `photo-${n}.png` && d.querySelector('[data-photo-position]')?.textContent === `${n} of ${total}`; }, { timeout: 10000 }, n, total).catch(async e => { console.log('state', JSON.stringify(await state(p))); throw e; }); const s = await state(p); assert.ok(s.src.includes(ids[n - 1]), `photo ${n} shows its own file: ${s.src}`); assert.equal(s.prev, n > 1, `previous at ${n}`); assert.equal(s.next, n < total, `next at ${n}`); assert.ok(s.focusInside, `focus inside the viewer at ${n}`); assert.ok(s.modal, 'the viewer is a top-layer modal'); return s; };
  const loaded = p => p.waitForFunction(() => { const i = document.querySelector('dialog[open] img'); return i?.complete && i.naturalWidth > 0; }, { timeout: 15000 });
  // The tap goes to the button's centre on the page; that is where it lands only while the page is not
  // pinch-zoomed (zoomed in, the browser's own pan shifts where a tap lands), so a zoomed page fails here.
  const press = async (p, label) => { const center = await p.evaluate(label => { const b = document.querySelector(`dialog[open] button[aria-label="${label}"]`); const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, hit: document.elementFromPoint(x, y)?.closest('button') === b, zoom: visualViewport.scale }; }, label); assert.ok(Math.abs(center.zoom - 1) < 0.01, `the page is not pinch-zoomed when ${label} is tapped (zoom ${center.zoom})`); assert.ok(center.hit, `${label} is what a tap at its centre reaches`); await p.mouse.click(center.x, center.y); };

  for (const device of before ? ['desktop'] : (process.env.PHOTO_DEVICES || 'desktop,phone').split(',')) {
    step(`${device}: open the room`);
    const phone = device === 'phone', theme = phone ? 'light' : 'dark';
    const p = await browser.newPage();
    await (phone ? p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }) : p.setViewport({ width: 1440, height: 900 }));
    await p.evaluateOnNewDocument(theme => { try { localStorage.setItem('longboard-public-chat-theme-v1', theme); } catch {} }, theme);
    const previews = [];
    p.on('request', r => { const m = r.url().match(/\/api\/chat\/attachments\/([0-9a-f-]+)\?preview=1/); if (m) previews.push(m[1]); });
    // Signed in already: the pages share the setup page's session.
    await p.goto(base + '/chat?room=main', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[role="log"] [aria-label="Message attachments"]', { timeout: 30000 });
    // A phone opens on the room list; tap the room to show it.
    if (phone) { await p.waitForSelector('nav[aria-label="Chat rooms"] [aria-current="page"]', { timeout: 30000 }); if (await p.$('[role="log"][data-photo-set]') && await p.$eval('[role="log"]', e => !!e.closest('[inert]'))) await p.$eval('nav[aria-label="Chat rooms"] [aria-current="page"]', e => e.click()); await p.waitForFunction(() => { const log = document.querySelector('[role="log"]'); return log && !log.closest('[inert]') && getComputedStyle(log).visibility === 'visible'; }, { timeout: 15000 }); }
    await p.waitForFunction(() => !document.querySelector('[data-positioning]'), { timeout: 30000 });
    const second = '[role="log"] button[aria-label="Enlarge photo-2.png"]';
    for (let i = 0; i < 20 && !(await p.$(second)); i++) { await p.evaluate(() => { const shown = document.querySelectorAll('[role="log"] [aria-label="Message attachments"]'); shown[1]?.scrollIntoView({ block: 'center' }); }); await sleep(500); }
    await p.$eval(second, b => b.scrollIntoView({ block: 'center' })); await sleep(400);

    step(`${device}: open the second photo`);
    await p.$eval(second, b => b.click()); await p.waitForSelector(viewer); await loaded(p);
    if (before) { await p.screenshot({ path: before }); console.log('saved', before, JSON.stringify(await state(p))); await p.close(); break; }
    await expectAt(p, 2);
    await p.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close image preview');
    // The neighbours (1 and 3) are fetched ahead of being shown.
    await p.waitForFunction(() => true); await sleep(300);
    assert.ok(previews.includes(ids[0]) && previews.includes(ids[2]), `neighbours of 2 preloaded: ${JSON.stringify(previews.map(id => ids.indexOf(id) + 1))}`);

    step(`${device}: Next shows the third`);
    await press(p, 'Next photo'); await expectAt(p, 3); await loaded(p);
    await sleep(300); assert.ok(previews.includes(ids[3]), 'the fourth is preloaded while the third shows');
    if (shots) { await sleep(300); await p.screenshot({ path: `${shots}/photo-next-${device}.png` }); }

    step(`${device}: arrow keys`);
    await p.keyboard.press('ArrowRight'); await expectAt(p, 4);
    await p.keyboard.press('ArrowLeft'); await expectAt(p, 3);
    await p.keyboard.press('ArrowLeft'); await expectAt(p, 2);
    await p.keyboard.press('ArrowRight'); await expectAt(p, 3);

    if (phone) {
      step('phone: swipe');
      const area = await p.$eval('dialog[open] [data-photo-stage]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const cdp = await p.createCDPSession();
      const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
      const swipe = async (from, to) => { await touch('touchStart', [from]); for (let i = 1; i <= 6; i++) await touch('touchMove', [[from[0] + (to[0] - from[0]) * i / 6, from[1] + (to[1] - from[1]) * i / 6]]); await touch('touchEnd', []); };
      await swipe([area.x + 120, area.y], [area.x - 120, area.y]); await expectAt(p, 4);
      await swipe([area.x - 120, area.y], [area.x + 120, area.y]); await expectAt(p, 3);
      // A mostly vertical drag is not a swipe.
      await swipe([area.x, area.y - 60], [area.x + 60, area.y + 120]); await sleep(400); assert.equal((await state(p)).label, '3 of 5', 'a vertical drag does not step');
      // A two-finger pinch (fingers moving apart sideways) is zoom, not a swipe.
      await touch('touchStart', [[area.x - 20, area.y], [area.x + 20, area.y]]);
      for (let i = 1; i <= 6; i++) await touch('touchMove', [[area.x - 20 - 25 * i, area.y], [area.x + 20 + 25 * i, area.y]]);
      await touch('touchEnd', []); await sleep(400);
      assert.equal((await state(p)).label, '3 of 5', 'a pinch does not step');
      // #456: the pinch is left to the browser, so it really zooms the page in (5x here). Zoom back out,
      // as a person would, before tapping the arrows: a tap at a button's page position misses on a
      // zoomed page once the browser has panned it, which it does on some runs and not others.
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await p.waitForFunction(() => Math.abs(visualViewport.scale - 1) < 0.01 && visualViewport.offsetLeft === 0 && visualViewport.offsetTop === 0, { timeout: 5000 });
      // The swipes stayed in the viewer: the browser's own Back (a swipe right) did not take the phone back to the room list.
      assert.equal(await p.evaluate(() => !!document.querySelector('[role="log"]').closest('[inert]')), false, 'the room is still open behind the viewer');
    }

    step(`${device}: no Next on the last, no Previous on the first`);
    await press(p, 'Next photo'); await expectAt(p, 4);
    await press(p, 'Next photo'); await expectAt(p, 5);
    // The Next button went away under the focus; focus stays in the viewer (on Previous).
    assert.equal(await p.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Previous photo');
    await p.keyboard.press('ArrowRight'); await sleep(300); await expectAt(p, 5);
    for (const n of [4, 3, 2, 1]) { await p.keyboard.press('ArrowLeft'); await expectAt(p, n); }
    await p.keyboard.press('ArrowLeft'); await sleep(300); await expectAt(p, 1);
    // Tab stays inside the viewer.
    for (let i = 0; i < 5; i++) { await p.keyboard.press('Tab'); assert.ok((await state(p)).focusInside, 'Tab stays in the viewer'); }
    await p.keyboard.press('ArrowRight'); await expectAt(p, 2);
    await p.keyboard.press('ArrowRight'); await expectAt(p, 3);

    step(`${device}: Escape closes, focus returns to a photo`);
    const expected = await p.evaluate(id => { const b = document.querySelector(`[role="log"] button[data-chat-photo="${id}"]`); if (!b) return 'photo-2.png'; const r = b.getBoundingClientRect(), log = document.querySelector('[role="log"]').getBoundingClientRect(); return r.bottom > Math.max(0, log.top) && r.top < Math.min(innerHeight, log.bottom) ? 'photo-3.png' : 'photo-2.png'; }, ids[2]);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });
    await p.waitForFunction(() => document.activeElement?.matches('button[data-chat-photo]'), { timeout: 3000 }).catch(async () => console.log('active after close', await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 160))));
    assert.equal(await p.evaluate(() => document.activeElement?.getAttribute('aria-label')), `Enlarge ${expected}`, 'focus is back on the photo now showing, or on the one opened');
    console.log(`${device}: focus returned to ${expected}`);

    if (!phone) {
      step('desktop: the replies thread has its own photos');
      const opener = await p.evaluateHandle(() => [...document.querySelectorAll('[role="log"] button')].find(b => /1 reply/.test(b.textContent)));
      await opener.evaluate(b => b.scrollIntoView({ block: 'center' })); await sleep(300);
      for (let i = 0; i < 3 && !(await p.$('[aria-label="Comment replies"]')); i++) { await opener.evaluate(b => b.click()); await p.waitForSelector('[aria-label="Comment replies"]', { timeout: 8000 }).catch(() => {}); }
      const replyButton = '[aria-label="Comment replies"] button[aria-label="Enlarge reply-photo.png"]';
      await p.waitForSelector(replyButton, { timeout: 30000 });
      await p.$eval(replyButton, b => b.click()); await p.waitForSelector(viewer);
      await p.waitForFunction(() => document.querySelector('dialog[open] [data-photo-position]')?.textContent === '2 of 2', { timeout: 10000 });
      let s = await state(p); assert.equal(s.title, 'reply-photo.png'); assert.ok(s.prev && !s.next);
      await p.keyboard.press('ArrowLeft');
      await p.waitForFunction(() => document.querySelector('dialog[open] h2')?.textContent === 'photo-1.png');
      s = await state(p); assert.equal(s.label, '1 of 2'); assert.ok(!s.prev && s.next);
      await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
      // Escape closed only the viewer, not the replies panel.
      assert.ok(await p.$('[aria-label="Comment replies"]'), 'the replies panel stays open');
    }
    await p.close();
  }
  console.log(before ? 'saved before screenshot' : 'PASS photo viewer: next/previous, keys, swipe, ends, preload, Escape and focus');
} finally { await browser.close(); }
