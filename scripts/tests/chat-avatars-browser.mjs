// #410 profile pictures, end to end on synthetic accounts and generated pictures (no real photos).
// Run with chat-avatars-fixture.mjs. Covers: choosing a photo (EXIF location and a sideways
// orientation), the circular preview with zoom and drag, saving, the picture beside messages, in the
// thread-free room list on a phone, the Member List and a DM; a renamed PDF refused; a member
// removing their own; an admin removing someone else's from the Member List; and a member refused.
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn } from './browser-login.mjs';
const base = process.env.CHAT_TEST_URL || 'http://localhost:3410', fixture = 'http://127.0.0.1:54610';
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const dir = mkdtempSync(join(tmpdir(), 'chat-avatars-'));
const errors = [];
const objects = async () => (await fetch(`${fixture}/test/avatar-objects`)).json();
const object = async (bucket, path) => Buffer.from(await (await fetch(`${fixture}/test/avatar-object?bucket=${bucket}&path=${encodeURIComponent(path)}`)).arrayBuffer());
// A drawn placeholder face on a gradient, saved sideways (EXIF orientation 6) with a GPS position.
async function photo(name, colors) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><defs><linearGradient id="g"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="900" height="600" fill="url(#g)"/><circle cx="450" cy="300" r="150" fill="#fde7c8"/></svg>`;
  const bytes = await sharp(Buffer.from(svg)).jpeg().withExif({ IFD0: { Make: 'SyntheticCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 26/1 46/1' } }).withMetadata({ orientation: 6 }).toBuffer();
  const file = join(dir, name);
  writeFileSync(file, bytes);
  return { file, bytes };
}
async function login(email, width) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  await page.setViewport({ width, height: width < 600 ? 844 : 900 });
  page.on('pageerror', e => errors.push(`${email}: ${e.message}`));
  page.on('dialog', d => d.accept());
  await signIn(page, base, email);
  return page;
}
async function clickText(page, selector, text) {
  await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some(e => e.checkVisibility() && e.textContent.trim() === t), { timeout: 30000 }, selector, text);
  await page.evaluate((s, t) => [...document.querySelectorAll(s)].find(e => e.checkVisibility() && e.textContent.trim() === t).click(), selector, text);
}
async function openProfile(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('chat-open-profile-settings')));
  await page.waitForSelector('dialog[open] section[aria-label="Picture"] input[type=file]', { timeout: 60000 });
}
const dialogText = (page, text) => page.waitForFunction(t => document.querySelector('dialog[open]')?.textContent.includes(t), { timeout: 60000 }, text);
// Pictures shown beside messages by a given author.
const rowPictures = (page, author) => page.evaluate(author => [...document.querySelectorAll('article[id^="chat-message-"]')]
  .filter(a => a.checkVisibility() && a.textContent.includes(author))
  .map(a => a.querySelector('[data-avatar]')).filter(Boolean)
  .map(t => ({ kind: t.dataset.avatar, src: t.querySelector('img')?.getAttribute('src') ?? null, loading: t.querySelector('img')?.loading ?? null, text: t.textContent })), author);
async function api(page, body) {
  return page.evaluate(async body => { const r = await fetch('/api/chat/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null) }; }, body);
}
try {
  const alice = await login('alice@example.test', 1280);
  await openProfile(alice);
  // Nothing yet: initials, and the accepted types and size next to the button.
  assert.equal(await alice.$eval('dialog[open] [data-avatar]', e => e.dataset.avatar), 'initials');
  await dialogText(alice, 'JPG, PNG, WebP or HEIC (iPhone), up to 10 MB.');

  // A PDF renamed to .jpg is refused with a clear message, and nothing is kept.
  const pdf = join(dir, 'statement.jpg');
  writeFileSync(pdf, '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
  await (await alice.$('dialog[open] input[type=file]')).uploadFile(pdf);
  await alice.waitForFunction(() => document.querySelector('dialog[open] [role=alert]')?.textContent.includes("isn't a picture"), { timeout: 60000 });
  assert.deepEqual((await objects()).filter(o => o.bucket === 'chat-avatar-uploads'), []);

  // A sideways photo with a location: the preview is upright, zoomable and draggable.
  const alicePhoto = await photo('alice.jpg', ['#3b82f6', '#a855f7']);
  assert.ok(alicePhoto.bytes.includes(Buffer.from('SyntheticCam')));
  await (await alice.$('dialog[open] input[type=file]')).uploadFile(alicePhoto.file);
  await alice.waitForSelector('dialog[open] [data-avatar-crop] img', { visible: true, timeout: 60000 });
  await alice.waitForFunction(() => document.querySelector('dialog[open] [data-avatar-crop] img')?.complete);
  const crop = await alice.$eval('dialog[open] [data-avatar-crop]', v => { const r = v.getBoundingClientRect(), i = v.querySelector('img'); return { w: r.width, h: r.height, radius: getComputedStyle(v).borderRadius, iw: i.offsetWidth, ih: i.offsetHeight }; });
  assert.equal(crop.radius, '50%');
  // 900 x 600 turned upright is 600 x 900: it fills the circle across and runs past it top to bottom.
  assert.ok(Math.abs(crop.iw - crop.w) < 2 && crop.ih > crop.h * 1.4, JSON.stringify(crop));
  // The staged copy is already the cleaned one: no camera name or location left.
  const staged = (await objects()).filter(o => o.bucket === 'chat-avatar-uploads');
  assert.equal(staged.length, 1);
  assert.equal(staged[0].mime, 'image/webp');
  assert.ok(!(await object('chat-avatar-uploads', staged[0].path)).includes(Buffer.from('SyntheticCam')));
  const zoom = await alice.$('dialog[open] input[type=range]');
  await zoom.evaluate(e => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, '2'); e.dispatchEvent(new Event('input', { bubbles: true })); });
  await alice.waitForFunction(w => document.querySelector('dialog[open] [data-avatar-crop] img').offsetWidth > w * 1.9, {}, crop.iw);
  const before = await alice.$eval('dialog[open] [data-avatar-crop] img', i => i.offsetTop);
  const box = await (await alice.$('dialog[open] [data-avatar-crop]')).boundingBox();
  await alice.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await alice.mouse.down();
  await alice.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 6 });
  await alice.mouse.up();
  assert.ok(await alice.$eval('dialog[open] [data-avatar-crop] img', (i, b) => i.offsetTop > b + 30, before), 'dragging moves the picture');
  await clickText(alice, 'dialog[open] button', 'Save picture');
  await dialogText(alice, 'Your picture has been updated.');
  assert.equal(await alice.$eval('dialog[open] [data-avatar]', e => e.dataset.avatar), 'picture');

  // Stored: two WebP squares under one random name, cached for a year, metadata gone; upload deleted.
  let stored = await objects();
  assert.deepEqual(stored.filter(o => o.bucket === 'chat-avatar-uploads'), []);
  const files = stored.filter(o => o.bucket === 'chat-avatars');
  assert.equal(files.length, 2);
  const name = files[0].path.replace(/-(64|256)\.webp$/, '');
  assert.match(name, /^[0-9a-f-]{36}$/);
  assert.deepEqual(files.map(f => f.path).sort(), [`${name}-256.webp`, `${name}-64.webp`]);
  for (const f of files) {
    assert.equal(f.mime, 'image/webp');
    assert.equal(f.cacheControl, '31536000');
    const bytes = await object('chat-avatars', f.path), meta = await sharp(bytes).metadata();
    assert.equal(meta.width, f.path.endsWith('-256.webp') ? 256 : 64);
    assert.equal(meta.height, meta.width);
    assert.equal(meta.exif, undefined);
    assert.ok(!bytes.includes(Buffer.from('SyntheticCam')) && !bytes.includes(Buffer.from('Exif')));
  }

  // Beside Alice's own messages at once, the 64px file, lazy-loaded.
  await alice.keyboard.press('Escape');
  await alice.waitForFunction(n => [...document.querySelectorAll('article[id^="chat-message-"] [data-avatar=picture] img')].some(i => i.src.endsWith(`${n}-64.webp`)), { timeout: 30000 }, name);
  for (const tile of await rowPictures(alice, 'Good morning, Longboard!')) {
    assert.equal(tile.kind, 'picture');
    assert.ok(tile.src.endsWith(`/storage/v1/object/public/chat-avatars/${name}-64.webp`), tile.src);
    assert.equal(tile.loading, 'lazy');
  }
  // Others still show initials.
  assert.ok((await rowPictures(alice, 'Looking forward to the discussion.')).every(t => t.kind === 'initials' && t.text === 'M'));

  // Bob adds his through the same steps (API), then sees both on a phone with no sideways scroll.
  const bob = await login('bob@example.test', 390);
  const bobPhoto = await photo('bob.jpg', ['#f59e0b', '#ef4444']);
  const bytes = bobPhoto.bytes.toString('base64');
  const bobSaved = await bob.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const post = body => fetch('/api/chat/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const start = await (await post({ action: 'start', byteSize: bytes.length })).json();
    await fetch(start.url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    if (!(await post({ action: 'preview', uploadId: start.uploadId })).ok) return null;
    return (await post({ action: 'save', uploadId: start.uploadId })).json();
  }, bytes);
  const bobName = bobSaved.member.avatar_path;
  assert.match(bobName, /^[0-9a-f-]{36}$/);
  await bob.reload();
  await bob.waitForFunction(n => [...document.querySelectorAll('article[id^="chat-message-"] [data-avatar=picture] img')].some(i => i.complete && i.naturalWidth === 64 && i.src.endsWith(`${n}-64.webp`)), { timeout: 60000 }, name);
  await bob.waitForFunction(n => [...document.querySelectorAll('article[id^="chat-message-"] [data-avatar=picture] img')].some(i => i.src.endsWith(`${n}-64.webp`)), { timeout: 30000 }, bobName);
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  // Bob can't remove Alice's picture.
  const [aliceRow] = await (await fetch(`${fixture}/rest/v1/longboard_chat_members?display_name=eq.Alice&select=id`, { headers: { authorization: 'Bearer test-service-role' } })).json();
  const refused = await api(bob, { action: 'remove', memberId: aliceRow.id });
  assert.equal(refused.status, 403);
  assert.equal((await objects()).filter(o => o.path.startsWith(name)).length, 2);

  // The Member List shows pictures; Alice (an admin) removes Bob's from there.
  await alice.reload();
  await alice.waitForSelector('textarea[aria-label^="Message "]', { visible: true, timeout: 60000 });
  await alice.click('button[aria-label="Room info"]');
  await clickText(alice, 'button', 'Member List');
  await alice.waitForFunction(n => [...document.querySelectorAll('dialog[open] [aria-label="Room members"] img[data-avatar=picture]')].some(i => i.src.endsWith(`${n}-64.webp`)), { timeout: 60000 }, bobName);
  await alice.click(`dialog[open] button[aria-label="Remove Bob's picture"]`);
  await dialogText(alice, "Bob's picture was removed.");
  assert.equal((await objects()).filter(o => o.path.startsWith(bobName)).length, 0);
  assert.equal(await alice.$(`dialog[open] button[aria-label="Remove Bob's picture"]`), null);
  await alice.keyboard.press('Escape');

  // #418: in the left column the picture and name sit on the left, and a name starts at the same
  // spot with or without a picture (Bob has none right now; he adds one below).
  const dmRow = () => alice.evaluate(() => {
    const row = [...document.querySelectorAll('aside[aria-label="Private conversations"] button')].find(b => b.checkVisibility() && b.textContent.trim().startsWith('Bob'));
    const face = row?.querySelector('[aria-hidden="true"]'), name = face?.nextElementSibling;
    if (!name) return null;
    const left = e => Math.round(e.getBoundingClientRect().left);
    return { row: left(row), face: left(face), name: left(name), picture: Boolean(face.querySelector('img[data-avatar=picture]')) };
  });
  await alice.goto(`${base}/chat`);
  await alice.waitForFunction(() => [...document.querySelectorAll('aside[aria-label="Private conversations"] button')].some(b => b.checkVisibility() && b.textContent.trim().startsWith('Bob') && !b.querySelector('img')), { timeout: 60000 });
  const bare = await dmRow();
  assert.equal(bare.picture, false);
  assert.ok(bare.face - bare.row <= 16, `the DM row starts on the left (${JSON.stringify(bare)})`);
  assert.equal(bare.name - bare.face, 30, 'a blank picture-sized space sits before a name without a picture');

  // A DM shows the other member's picture: Bob's request to Alice, after Bob adds a new one.
  const again = await bob.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const post = body => fetch('/api/chat/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const start = await (await post({ action: 'start', byteSize: bytes.length })).json();
    await fetch(start.url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    await post({ action: 'preview', uploadId: start.uploadId });
    return (await post({ action: 'save', uploadId: start.uploadId })).json();
  }, bytes);
  await alice.goto(`${base}/chat`);
  await alice.waitForSelector('textarea[aria-label^="Message "]', { visible: true, timeout: 60000 });
  await alice.waitForFunction(n => [...document.querySelectorAll('aside[aria-label="Private conversations"] img[data-avatar=picture]')].some(i => i.checkVisibility() && i.src.endsWith(`${n}-64.webp`)), { timeout: 60000 }, again.member.avatar_path);
  assert.deepEqual(await dmRow(), { ...bare, picture: true }, 'a name with a picture starts where a name without one does');

  // #446: in the @ menu every name starts at the same spot, right after the picture when there is
  // one (Alice and Bob have one now, Mallory and Buddy don't). Measures the name text itself, so a
  // name pushed to the middle of its row fails.
  const composer = 'textarea[aria-label^="Message "]';
  await alice.click(composer);
  await alice.type(composer, '@');
  const menu = '[role="listbox"][aria-label="Mention a member"]';
  await alice.waitForFunction(m => {
    const rows = [...document.querySelectorAll(`${m} [role="option"]`)];
    const pics = rows.map(r => r.querySelector('img[data-avatar=picture]')).filter(Boolean);
    return rows.length >= 3 && pics.length >= 2 && pics.every(i => i.complete && i.naturalWidth > 0) && rows.some(r => !r.querySelector('img'));
  }, { timeout: 60000 }, menu);
  if (process.env.CHAT_SHOT_DIR) await (await alice.$(menu)).screenshot({ path: `${process.env.CHAT_SHOT_DIR}/${process.env.CHAT_SHOT_PHASE || 'after'}-menu.png` });
  const menuRows = await alice.$$eval(`${menu} [role="option"]`, rows => rows.map(row => {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode()) && !text.data.startsWith('@'));
    const range = document.createRange();
    range.selectNodeContents(text);
    const img = row.querySelector('img[data-avatar=picture]');
    return { name: text.data, row: Math.round(row.getBoundingClientRect().left), text: Math.round(range.getBoundingClientRect().left), picture: img ? Math.round(img.getBoundingClientRect().right) : null };
  }));
  const starts = new Set(menuRows.map(r => r.text - r.row));
  assert.equal(starts.size, 1, `every @ menu name starts at the same spot ${JSON.stringify(menuRows)}`);
  assert.ok([...starts][0] <= 48, `names sit on the left ${JSON.stringify(menuRows)}`);
  for (const r of menuRows.filter(r => r.picture !== null)) assert.ok(r.text - r.picture >= 2 && r.text - r.picture <= 12, `the name follows the picture ${JSON.stringify(r)}`);
  await alice.keyboard.press('Escape');
  await alice.$eval(composer, e => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); });
  await alice.evaluate(() => [...document.querySelectorAll('aside[aria-label="Private conversations"] button')].find(b => b.checkVisibility() && b.textContent.trim().startsWith('Bob')).click());
  await alice.waitForFunction(n => [...document.querySelectorAll('section[aria-label="Private conversation"] img[data-avatar=picture]')].some(i => i.src.endsWith(`${n}-64.webp`)), { timeout: 60000 }, again.member.avatar_path);

  // Alice removes her own: back to initials, files gone.
  await openProfile(alice);
  await clickText(alice, 'dialog[open] button', 'Remove picture');
  await dialogText(alice, 'Your picture was removed.');
  assert.equal(await alice.$eval('dialog[open] [data-avatar]', e => e.dataset.avatar), 'initials');
  stored = await objects();
  assert.equal(stored.filter(o => o.path.startsWith(name)).length, 0);
  await alice.keyboard.press('Escape');
  await alice.goto(`${base}/chat`);
  await alice.waitForFunction(() => [...document.querySelectorAll('article[id^="chat-message-"]')].some(a => a.textContent.includes('Good morning, Longboard!') && a.querySelector('[data-avatar=initials]')?.textContent === 'A'), { timeout: 60000 });

  assert.deepEqual(errors, []);
  console.log('PASS picture upload, PDF refused, upright preview with zoom and drag, two cleaned WebP files cached for a year, pictures beside messages (64px, lazy) on desktop and phone, Member List, DM (left-aligned, names in one column), @ menu names in one column (#446), member refused, admin removal, own removal back to initials.');
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
