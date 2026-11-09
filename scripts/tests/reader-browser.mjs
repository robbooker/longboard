// #385 Reader: the real PublicChat sidebar and library, the real reading screen (epub.js and PDF.js)
// and the real /api/chat/reader/* routes and /reader page (bundled for Node, with sign-in stubbed and
// an in-memory database and bucket from lib/__tests__/readerFakeDb.ts). The books are made by
// reader-fixture.mjs. Nothing leaves this machine.
//
// Checks: the Reader row sits under News Feed and opens the shelf (covers, titles, authors, "New");
// an EPUB opens full screen with its cover, chapters and contents; nothing active in the book runs
// (script, onerror, javascript: link) and its iframe is sandboxed without scripts; pages turn by
// clicking the edges and with the arrow keys; the contents list jumps to a chapter; the text gets
// bigger; Sepia and the chat's Terminal theme apply to the page; the place is saved to the account
// a moment later and a reload opens at the same place; the shelf shows the progress; a PDF opens at
// page 1, turns pages and has its bookmarks as contents; a phone (390px) has no sideways scroll and
// turns pages by swiping and tapping; an admin uploads a PDF and an EPUB (whose title, author and
// cover are read from the file), hides, reorders and deletes; a member without access sees no row,
// is refused by every route and gets the members-only message on /reader.
//
// Usage: node scripts/tests/reader-browser.mjs [--shots <dir>]
//   --shots writes t385-shelf.png, t385-reading.png and t385-phone.png into <dir>.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer';
import { CHAPTERS, EPUB_AUTHOR, EPUB_TITLE, makeEpub, makePdf } from './reader-fixture.mjs';
const args = process.argv.slice(2), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const root = new URL('../../', import.meta.url).pathname, dir = join(root, 'node_modules', '.cache', `reader-test-${process.pid}`);
await mkdir(dir, { recursive: true });

const EPUB_ID = '11111111-1111-4111-8111-111111111111', PDF_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER = { ok: true, user: { id: 'acct-member', role: 'user' }, access: { longboard: true, boardroom: true, shortscout: false, admin: false } };
const ADMIN = { ok: true, user: { id: 'acct-admin', role: 'admin' }, access: { longboard: true, boardroom: true, shortscout: false, admin: true } };
const OUTSIDER = { ok: true, user: { id: 'acct-out', role: 'user' }, access: { longboard: false, shortscout: false, admin: false, botRooms: ['social'] } };
globalThis.__readerTest = { auth: MEMBER, db: null };

// The real routes and page, with sign-in and the database stubbed. Written under node_modules so `next` resolves.
await build({ stdin: { contents: `
  export * as books from './app/api/chat/reader/books/route';
  export * as book from './app/api/chat/reader/books/[id]/route';
  export * as progress from './app/api/chat/reader/progress/route';
  export * as order from './app/api/chat/reader/order/route';
  export { default as ReaderPage } from './app/reader/[bookId]/page';
  export { createReaderFakeDb } from './lib/__tests__/readerFakeDb';
  export { renderToStaticMarkup } from 'react-dom/server';`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'server.mjs'), alias: { '@': root }, jsx: 'automatic', external: ['next', 'next/*', 'react', 'react-dom', 'react-dom/*'],
  plugins: [{ name: 'server-stubs', setup(b) {
    b.onResolve({ filter: /^next\/(server|navigation)$/ }, (a) => ({ path: `${a.path}.js`, external: true }));
    b.onResolve({ filter: /^@\/(lib\/(chatAuth|chatAdmin)|components\/reader\/ReaderScreen)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ loader: 'tsx', contents: a.path.endsWith('chatAuth')
      ? `export async function requireChatUser(){return globalThis.__readerTest.auth;}`
      : a.path.endsWith('chatAdmin')
        ? `export function createChatAdminClient(){return globalThis.__readerTest.db;}
           export function requestOriginAllowed(r){const o=r.headers.get('origin');if(!o)return true;try{return new URL(o).host===r.headers.get('host');}catch{return false;}}`
        : `export default function ReaderScreen(){return null;}` }));
  } }] });
const server_ = await import(join(dir, 'server.mjs'));

const member = { id: '11111111-1111-4111-8111-1111111111aa', display_name: 'Alice', accepts_requests: true };
const roomState = { isOpen: true, notice: null, pausedAt: null, updatedAt: new Date().toISOString() };
let rooms = ['main', 'social', 'gainers'];
const messages = Object.fromEntries(rooms.map((room) => [room, [{ id: randomUUID(), room_slug: room, member_id: null, guest_id: null, author_label: 'Bob', body: `Welcome to ${room}`, created_at: new Date(Date.now() - 60000).toISOString(), unread_seq: 1 }]]));
const bootstrap = { accountId: 'test-account', room: 'main', member, roomState, messages: [], reactions: [], counts: {}, featureChannel: false };
await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import PublicChat from './components/chat/PublicChat';import ReaderView from './components/reader/ReaderView';
  const rooms=JSON.parse(new URLSearchParams(location.search).get('rooms')||'null')||${JSON.stringify(rooms)};
  const props={accountId:'test-account',bootstrap:${JSON.stringify(bootstrap)},allowedRooms:rooms,serverSession:false,room:'main',fontVariableClass:'',appVersion:'test'};
  const book=location.pathname.startsWith('/reader/')?location.pathname.split('/')[2]:null;
  createRoot(document.getElementById('root')).render(book?<ReaderView bookId={book}/>:<PublicChat {...props} popout={false}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', outdir: dir, entryNames: 'bundle', alias: { '@': root }, loader: { '.module.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [{ name: 'test-platform', setup(b) {
    b.onResolve({ filter: /^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client|\.\/pdfWorker)$/ }, (a) => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({ loader: 'tsx', resolveDir: root, contents:
      a.path === './pdfWorker' ? `export const PDF_WORKER_URL='/pdf.worker.mjs';`
      : a.path === 'next/dynamic' ? `import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={<p>Loading…</p>}><C {...props}/></React.Suspense>;}`
      : a.path === 'next/navigation' ? `export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`
      : a.path.includes('supabase') ? `export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:()=>channel,removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`
      : `import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,prefetch,...props}){return React.createElement(${a.path === 'next/link' ? "'a'" : "'img'"},props,children);}` }));
  } }] });

const activity = { mentions: [], dms: [], mentionCount: 0, dmCount: 0, mentionThrough: 0, dmThrough: 0, roomCounts: {}, roomThrough: {}, roomMessageCounts: {}, roomMessageThrough: {} };
function read(path) {
  const u = new URL(path, 'http://localhost'); const room = u.searchParams.get('room') || 'main';
  if (u.pathname === '/api/chat/quad-options') return { accountId: 'test-account', rooms, conversations: [], gainersTable: rooms.includes('gainers') };
  if (u.pathname === '/api/chat/history') return { messages: messages[room] || [], reactions: [], hasMore: false };
  if (u.pathname === '/api/chat/thread-counts') return { counts: {} };
  if (u.pathname === '/api/chat/opening') return { messageId: null, readThrough: 0 };
  if (u.pathname === '/api/chat/inbox') return { conversations: [], summaries: [] };
  if (u.pathname === '/api/chat/activity') return activity;
  if (u.pathname === '/api/chat') return roomState;
  if (u.pathname === '/api/chat/pins') return { pins: [] };
  if (u.pathname === '/api/chat/pages') return { pages: [], canManage: false, suggestions: [], waiting: [] };
  if (u.pathname === '/api/chat/members') return { members: [] };
  if (u.pathname === '/api/chat/news/feed') return { gainers: [], items: [], partial: false };
  if (u.pathname === '/api/chat/gainers/table') return { day: '2026-11-08', rows: [] };
  return {};
}
const progressPuts = [];
const body = async (req) => { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); };
const server = createServer(async (req, res) => {
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const url = new URL(req.url, 'http://x');
  if ((url.pathname === '/chat' || url.pathname.startsWith('/reader/'))) { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script type="module" src="/bundle.js"></script>'); }
  if (['/bundle.js', '/bundle.css'].includes(url.pathname)) { res.setHeader('Content-Type', url.pathname.endsWith('css') ? 'text/css' : 'text/javascript'); return res.end(await readFile(join(dir, url.pathname.slice(1)))); }
  if (url.pathname === '/pdf.worker.mjs') { res.setHeader('Content-Type', 'text/javascript'); return res.end(await readFile(join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'))); }
  if (url.pathname === '/chat-sw.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(''); }
  // The private bucket: signed downloads (with Range for the server's check) and signed uploads.
  if (url.pathname.startsWith('/storage/signed/')) {
    const file = fake.files.get(decodeURIComponent(url.pathname.slice('/storage/signed/'.length)));
    if (!file) { res.writeHead(404); return res.end(); }
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    return res.end(range ? file.subarray(Number(range[1]), Number(range[2]) + 1) : file);
  }
  if (url.pathname.startsWith('/storage/upload/') && req.method === 'PUT') {
    fake.files.set(decodeURIComponent(url.pathname.slice('/storage/upload/'.length)), await body(req)); return send({ Key: 'ok' });
  }
  // The Reader routes, called as Next would call them.
  if (url.pathname.startsWith('/api/chat/reader/')) {
    const raw = req.method === 'GET' || req.method === 'HEAD' ? undefined : await body(req);
    const request = new Request(base + req.url, { method: req.method, headers: { ...req.headers, host: new URL(base).host }, body: raw });
    request.nextUrl = new URL(request.url);
    const parts = url.pathname.split('/').slice(4);
    let response;
    if (parts[0] === 'books' && !parts[1]) response = await server_.books[req.method](request);
    else if (parts[0] === 'books') response = await server_.book[req.method](request, { params: Promise.resolve({ id: parts[1] }) });
    else if (parts[0] === 'progress') { response = await server_.progress[req.method](request); if (response.ok) progressPuts.push(JSON.parse(raw.toString())); }
    else if (parts[0] === 'order') response = await server_.order[req.method](request);
    res.writeHead(response.status, { 'Content-Type': 'application/json' }); return res.end(await response.text());
  }
  if (req.method !== 'POST') return send(read(req.url));
  const sent = JSON.parse((await body(req)).toString() || '{}');
  if (req.url === '/api/chat/updates') return send({ results: sent.paths.map((path) => ({ path, status: 200, data: read(path) })) });
  if (req.url === '/api/chat/message-reactions') return send({ messages: {} });
  return send({});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;

// The shelf: an EPUB with its cover and a PDF without one.
const epub = await makeEpub(), pdf = makePdf(3);
const fake = server_.createReaderFakeDb({ reader_books: [
  { id: EPUB_ID, title: EPUB_TITLE, author: EPUB_AUTHOR, format: 'epub', storage_path: `books/${EPUB_ID}.epub`, cover_path: `covers/${EPUB_ID}.png`, byte_size: epub.length, sort: 1, hidden: false, ready: true, created_at: '2026-11-08T00:00:00Z' },
  { id: PDF_ID, title: 'Longboard System Bible', author: 'Rob Booker', format: 'pdf', storage_path: `books/${PDF_ID}.pdf`, cover_path: null, byte_size: pdf.length, sort: 2, hidden: false, ready: true, created_at: '2026-11-08T00:00:00Z' },
] }, `${base}/storage`);
fake.files.set(`books/${EPUB_ID}.epub`, epub); fake.files.set(`books/${PDF_ID}.pdf`, pdf);
fake.files.set(`covers/${EPUB_ID}.png`, (await import('./reader-fixture.mjs')).COVER_PNG);
globalThis.__readerTest.db = fake.db;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const loc = (p) => p.$eval('[data-reader]', (e) => e.dataset.readerLocation ?? '');
// Waits for the reported place to change from `from` and returns the new one.
const moved = async (p, from) => { await p.waitForFunction((was) => (document.querySelector('[data-reader]').dataset.readerLocation ?? '') !== was, { timeout: 5000 }, from); return loc(p); };
const label = (p) => p.$eval('[data-reader-progress]', (e) => e.textContent);
const chapter = (p) => p.$eval('[data-reader-chapter]', (e) => e.textContent);
const frame = async (p) => (await (await p.waitForSelector('[data-reader-host] iframe')).contentFrame());
// The CFI the reader last reported, read from what it is about to save.
const savedFor = (id) => fake.tables.reader_progress.find((r) => r.account_id === globalThis.__readerTest.auth.user.id && r.book_id === id);
const waitSaved = async (id, test, what) => { for (let i = 0; i < 60; i++) { const row = savedFor(id); if (row && test(row)) return row; await pause(100); } assert.fail(`not saved: ${what}`); };
const openEpub = async (p) => { await p.goto(`${base}/reader/${EPUB_ID}`); await p.waitForSelector('[data-reader-next]', { timeout: 15000 }).catch(async (e) => { console.log('reader shows:', await p.evaluate(() => document.body.innerText)); throw e; }); const f = await frame(p); await f.waitForSelector('h1'); await p.waitForSelector('[data-reader][data-reader-location]'); return f; };
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const p = await browser.newPage(), errors = [];
  p.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
  p.on('console', (m) => { if (m.type() === 'error' && !/sandboxed and the 'allow-scripts'|Failed to load resource/.test(m.text())) console.log('console:', m.text()); });
  await p.setViewport({ width: 1280, height: 860 });
  await p.evaluateOnNewDocument(() => { try { if (!localStorage.getItem('longboard-public-chat-theme-v1')) localStorage.setItem('longboard-public-chat-theme-v1', 'light'); } catch {} });

  // 1. The row sits under News Feed and opens the shelf.
  await p.goto(base + '/chat'); await p.waitForSelector('a[data-chat-reader]');
  assert.equal(await p.$eval('a[data-chat-news-feed]', (a) => a.nextElementSibling?.matches('a[data-chat-reader]')), true, 'Reader is right under News Feed');
  await p.click('a[data-chat-reader]'); await p.waitForSelector('[data-reader-library] [data-reader-book]');
  assert.equal(await p.$eval('a[data-chat-reader]', (a) => a.getAttribute('aria-current')), 'page');
  const shelf = await p.$$eval('[data-reader-book]', (b) => b.map((e) => ({ id: e.dataset.readerBook, text: e.textContent, img: e.querySelector('img')?.src ?? null, href: e.querySelector('a').getAttribute('href') })));
  assert.deepEqual(shelf.map((b) => b.id), [EPUB_ID, PDF_ID]);
  assert.match(shelf[0].text, new RegExp(`${EPUB_TITLE}.*${EPUB_AUTHOR}.*New`));
  assert.ok(shelf[0].img?.includes(`/storage/signed/covers/${EPUB_ID}.png`), 'the cover comes through a signed link');
  assert.equal(shelf[1].img, null, 'a book without a cover gets a plain one');
  assert.equal(shelf[0].href, `/reader/${EPUB_ID}`);
  assert.equal(await p.$('[data-reader-manage]'), null, 'members get no Manage books');
  assert.ok(await noSideScroll(p));
  if (shots) { await pause(300); await p.screenshot({ path: join(shots, 't385-shelf.png') }); }

  // 2. The EPUB opens full screen; nothing active in it runs.
  let f = await openEpub(p);
  assert.equal(await f.$eval('h1', (h) => h.textContent), CHAPTERS[0]);
  assert.equal(await chapter(p), CHAPTERS[0]);
  const sandbox = await p.$eval('[data-reader-host] iframe', (i) => i.getAttribute('sandbox'));
  assert.equal(sandbox, 'allow-same-origin', 'no allow-scripts, no popups');
  assert.equal(await f.$$eval('script', (s) => s.length), 0, 'scripts are stripped');
  assert.equal(await f.$$eval('[onerror]', (s) => s.length), 0, 'event handlers are stripped');
  assert.equal(await f.$eval('#jslink', (a) => a.getAttribute('href')), null, 'javascript: links are stripped');
  await f.$eval('#jslink', (a) => a.click()).catch(() => {});
  await pause(300);
  assert.equal(await p.evaluate(() => window.__readerPwned), undefined, 'nothing in the book ran');
  assert.equal(await p.$eval('[data-reader]', (e) => e.dataset.readerTheme), 'light', 'matches the light chat theme');
  assert.deepEqual(await p.$$eval('[data-reader-toc-button]', (b) => b.map((e) => e.disabled)), [false]);

  // 3. Turning pages: the right edge, then arrow keys, the left edge back.
  const firstPos = await loc(p);
  await p.click('[data-reader-next]'); const afterClick = await moved(p, firstPos);
  await p.keyboard.press('ArrowRight'); const afterKey = await moved(p, afterClick);
  assert.notEqual(afterKey, firstPos, 'the right arrow turns the page');
  await p.keyboard.press('ArrowLeft'); assert.equal(await moved(p, afterKey), afterClick, 'the left arrow goes back');
  await p.click('[data-reader-prev]'); assert.equal(await moved(p, afterClick), firstPos, 'the left edge goes back');
  await p.waitForFunction(() => /^\d+% · (\d+ min|less than a minute) left in chapter$/.test(document.querySelector('[data-reader-progress]').textContent), { timeout: 10000 });

  // 4. Contents: jump to chapter III.
  await p.click('[data-reader-toc-button]'); await p.waitForSelector('[data-reader-toc]');
  assert.deepEqual(await p.$$eval('[data-reader-toc] li', (l) => l.map((e) => e.textContent)), CHAPTERS);
  await p.evaluate((t) => [...document.querySelectorAll('[data-reader-toc] button')].find((b) => b.textContent === t).click(), CHAPTERS[2]);
  await p.waitForFunction((t) => document.querySelector('[data-reader-chapter]').textContent === t, {}, CHAPTERS[2]);
  f = await frame(p); await f.waitForSelector('h1');
  assert.equal(await f.$eval('h1', (h) => h.textContent), CHAPTERS[2]);
  // Then one page further in, so the saved place is inside the chapter.
  await p.keyboard.press('ArrowRight'); await pause(300);

  // 5. Text size and theme.
  await p.click('[data-reader-settings-button]'); await p.waitForSelector('[data-reader-settings]');
  const sizeBefore = await f.evaluate(() => parseFloat(getComputedStyle(document.querySelector('p')).fontSize));
  await p.click('[data-reader-font="larger"]'); await p.click('[data-reader-font="larger"]');
  assert.equal(await p.$eval('[data-reader-font-size]', (e) => e.textContent), '120%');
  await pause(500); f = await frame(p);
  const sizeAfter = await f.evaluate(() => parseFloat(getComputedStyle(document.querySelector('p')).fontSize));
  assert.ok(sizeAfter > sizeBefore * 1.1, `text gets bigger (${sizeBefore} → ${sizeAfter})`);
  await p.click('[data-reader-theme-choice="sepia"]'); await pause(300); f = await frame(p);
  assert.equal(await p.$eval('[data-reader]', (e) => e.dataset.readerTheme), 'sepia');
  assert.equal(await f.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(244, 236, 216)', 'the page itself turns sepia');
  assert.equal(await f.evaluate(() => getComputedStyle(document.body).color), 'rgb(74, 59, 42)');
  await p.keyboard.press('Escape'); await p.waitForSelector('[data-reader-settings]', { hidden: true });

  // 6. The place is saved to the account a moment later; a reload opens at the same place.
  const saved = await waitSaved(EPUB_ID, (r) => r.percent > 0.5, 'chapter III place');
  assert.match(saved.location, /^epubcfi\(\/6\/6!/, 'the saved place is in chapter III');
  const before = { chapter: await chapter(p), text: await f.evaluate(() => document.querySelector('p').textContent.slice(0, 40)) };
  if (shots) { await pause(300); await p.screenshot({ path: join(shots, 't385-reading.png') }); }
  const putsBefore = progressPuts.length;
  f = await openEpub(p);
  await p.waitForFunction((t) => document.querySelector('[data-reader-chapter]').textContent === t, {}, before.chapter);
  assert.equal(await f.$eval('h1', (h) => h.textContent), CHAPTERS[2], 'reload restores the chapter');
  assert.equal(await p.$eval('[data-reader]', (e) => e.dataset.readerTheme), 'sepia', 'the theme is remembered');
  assert.equal(await loc(p), saved.location, 'and the same page inside it');
  await pause(2000);
  assert.equal(savedFor(EPUB_ID).location, saved.location, 'opening at the saved place keeps it');
  assert.ok(progressPuts.length - putsBefore <= 1, 'opening a book does not keep saving');

  // 7. The shelf shows the progress.
  await p.goto(base + '/chat?page=reader'); await p.waitForSelector(`[data-reader-book="${EPUB_ID}"]`);
  assert.equal(await p.$eval(`[data-reader-book="${EPUB_ID}"] [data-reader-percent]`, (e) => e.textContent), `${Math.round(savedFor(EPUB_ID).percent * 100)}%`);

  // 8. The PDF: page 1 of 3, turns pages, bookmarks as contents, Terminal follows the chat.
  await p.evaluate(() => { localStorage.setItem('longboard-public-chat-theme-v1', 'terminal'); localStorage.setItem('longboard-reader-prefs-v1', JSON.stringify({ theme: 'auto', fontSize: 120 })); });
  await p.goto(`${base}/reader/${PDF_ID}`); await p.waitForSelector('[data-reader-pdf-page][data-page="1"]');
  assert.equal(await chapter(p), 'Page 1 of 3');
  assert.equal(await p.$eval('[data-reader]', (e) => e.dataset.readerTheme), 'terminal', 'Match chat follows the Terminal theme');
  assert.match(await p.$eval('[data-reader-pdf-page]', (c) => c.style.filter), /invert/, 'the PDF page is tinted dark');
  await p.click('[data-reader-next]'); await p.waitForSelector('[data-reader-pdf-page][data-page="2"]');
  await p.keyboard.press('ArrowRight'); await p.waitForSelector('[data-reader-pdf-page][data-page="3"]');
  assert.equal(await p.$eval('[data-reader-next]', (b) => b.disabled), true, 'no page after the last');
  assert.equal(await label(p), '100%');
  await p.click('[data-reader-toc-button]'); await p.waitForSelector('[data-reader-toc]');
  assert.deepEqual(await p.$$eval('[data-reader-toc] li', (l) => l.map((e) => e.textContent)), ['Section 1', 'Section 2', 'Section 3']);
  await p.evaluate(() => [...document.querySelectorAll('[data-reader-toc] button')][1].click());
  await p.waitForSelector('[data-reader-pdf-page][data-page="2"]');
  await waitSaved(PDF_ID, (r) => r.location === '2', 'PDF page 2');
  await p.reload(); await p.waitForSelector('[data-reader-pdf-page][data-page="2"]');
  assert.equal(await chapter(p), 'Page 2 of 3', 'the PDF reopens at page 2');

  // 9. A phone: no sideways scroll; swipes and edge taps turn pages.
  await p.evaluate(() => localStorage.setItem('longboard-reader-prefs-v1', JSON.stringify({ theme: 'auto', fontSize: 100 })));
  await p.evaluate(() => localStorage.setItem('longboard-public-chat-theme-v1', 'light'));
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  f = await openEpub(p); await pause(500);
  assert.ok(await noSideScroll(p), 'phone: no sideways scroll');
  assert.equal(await p.$eval('[data-reader-host] .epub-container', (c) => c.getBoundingClientRect().right <= innerWidth && getComputedStyle(c).overflow === 'hidden'), true, 'the page fits the phone');
  const pos0 = await loc(p);
  // A quick sideways swipe across the page (the book's iframe passes it to the reader).
  const swipe = async (from, to) => { await p.touchscreen.touchStart(from, 420); await p.touchscreen.touchMove((from + to) / 2, 422); await p.touchscreen.touchMove(to, 424); await p.touchscreen.touchEnd(); };
  // The tap comes first: Chrome swallows a tap that lands while a swipe's fling is still running.
  await p.tap('[data-reader-next]');
  const pos1 = await moved(p, pos0);
  await swipe(90, 300);
  assert.equal(await moved(p, pos1), pos0, 'a swipe right turns back');
  await swipe(300, 90);
  assert.equal(await moved(p, pos0), pos1, 'a swipe left turns the page');
  if (shots) { await pause(300); await p.screenshot({ path: join(shots, 't385-phone.png') }); }
  await p.goto(base + '/chat?page=reader'); await p.waitForSelector('[data-reader-book]'); await pause(300);
  assert.ok(await noSideScroll(p), 'phone shelf: no sideways scroll');
  await p.setViewport({ width: 1280, height: 860, isMobile: false, hasTouch: false });

  // 10. An admin uploads a PDF and an EPUB, hides, reorders and deletes.
  globalThis.__readerTest.auth = ADMIN;
  await p.goto(base + '/chat?page=reader'); await p.waitForSelector('[data-reader-manage]');
  await p.click('[data-reader-manage]'); await p.waitForSelector('[data-reader-upload]');
  await writeFile(join(dir, 'Club Notes.pdf'), makePdf(2)); await writeFile(join(dir, 'fables.epub'), epub);
  await (await p.$('[data-reader-file]')).uploadFile(join(dir, 'Club Notes.pdf'));
  await p.waitForFunction(() => document.querySelector('[data-reader-title]').value === 'Club Notes');
  await p.type('[data-reader-author]', 'Rob Booker');
  await p.click('[data-reader-submit]');
  await p.waitForFunction(() => /is on the shelf/.test(document.querySelector('[data-reader-admin-message]')?.textContent ?? ''), { timeout: 10000 });
  let added = fake.tables.reader_books.find((b) => b.title === 'Club Notes');
  assert.ok(added?.ready, 'the uploaded PDF was checked and is on the shelf');
  assert.ok(fake.files.get(added.storage_path)?.subarray(0, 5).toString() === '%PDF-');
  await p.waitForSelector(`[data-reader-book="${added.id}"]`);
  // The EPUB's own title, author and cover are filled in.
  await (await p.$('[data-reader-file]')).uploadFile(join(dir, 'fables.epub'));
  await p.waitForFunction((t) => document.querySelector('[data-reader-title]').value === t, {}, EPUB_TITLE);
  assert.equal(await p.$eval('[data-reader-author]', (e) => e.value), EPUB_AUTHOR);
  await p.waitForSelector('[data-reader-admin] img');
  await p.click('[data-reader-submit]');
  await p.waitForFunction(() => /is on the shelf/.test(document.querySelector('[data-reader-admin-message]')?.textContent ?? ''), { timeout: 10000 });
  const second = fake.tables.reader_books.filter((b) => b.title === EPUB_TITLE).find((b) => b.id !== EPUB_ID);
  assert.ok(second?.ready && second.cover_path?.endsWith('.png') && fake.files.has(second.cover_path), 'the EPUB came with its own cover');
  // Hide: members no longer see it.
  await p.click(`[data-reader-manage-row="${added.id}"] [data-reader-hide]`);
  await p.waitForFunction((id) => document.querySelector(`[data-reader-book="${id}"]`)?.hasAttribute('data-hidden'), {}, added.id);
  globalThis.__readerTest.auth = MEMBER;
  assert.ok(!(await (await fetch(`${base}/api/chat/reader/books`)).json()).books.some((b) => b.id === added.id), 'hidden from members');
  assert.equal((await fetch(`${base}/api/chat/reader/books/${added.id}`)).status, 404);
  globalThis.__readerTest.auth = ADMIN;
  // Reorder: move the PDF Bible to the top.
  await p.click(`[data-reader-manage-row="${PDF_ID}"] [data-reader-up]`);
  await p.waitForFunction((id) => document.querySelector('[data-reader-book]')?.dataset.readerBook === id, {}, PDF_ID);
  // Delete.
  p.once('dialog', (d) => d.accept());
  await p.click(`[data-reader-manage-row="${second.id}"] [data-reader-delete]`);
  await p.waitForFunction((id) => !document.querySelector(`[data-reader-book="${id}"]`), {}, second.id);
  assert.ok(!fake.files.has(second.storage_path) && !fake.tables.reader_books.some((b) => b.id === second.id), 'deleted with its file');

  // 11. Without access: no row, every route refuses, the page says members only.
  globalThis.__readerTest.auth = OUTSIDER;
  for (const [path, method] of [['/api/chat/reader/books', 'GET'], [`/api/chat/reader/books/${EPUB_ID}`, 'GET'], ['/api/chat/reader/progress', 'PUT'], ['/api/chat/reader/books', 'POST']])
    assert.equal((await fetch(base + path, { method, ...(method !== 'GET' ? { body: '{}' } : {}) })).status, 403, `${method} ${path} refused`);
  // #384: the "reader" entitlement alone opens the Reader (a club member without the Gainers room).
  globalThis.__readerTest.auth = { ok: true, user: { id: 'acct-club', role: 'user' }, access: { longboard: false, shortscout: false, admin: false, member: ['reader'] } };
  assert.equal((await fetch(`${base}/api/chat/reader/books`)).status, 200, 'reader entitlement opens the shelf');
  globalThis.__readerTest.auth = OUTSIDER;
  rooms = ['social'];
  await p.goto(base + '/chat?page=reader&rooms=' + encodeURIComponent(JSON.stringify(rooms))); await p.waitForSelector('nav'); await pause(400);
  assert.equal(await p.$('a[data-chat-reader]'), null, 'no Reader row without access');
  await p.waitForSelector('[data-reader-library][data-reader-blocked]');
  assert.match(await p.$eval('[data-reader-library]', (e) => e.textContent), /for Booker Stock Club members/, 'the link shows the members-only note, no books');
  assert.equal(await p.$('[data-reader-book]'), null);
  await p.goto(`${base}/reader/${EPUB_ID}`); await p.waitForSelector('[data-reader-status="error"]');
  assert.match(await p.$eval('[data-reader-status="error"]', (e) => e.textContent), /for Booker Stock Club members/);
  const blocked = server_.renderToStaticMarkup(await server_.ReaderPage({ params: Promise.resolve({ bookId: EPUB_ID }) }));
  assert.match(blocked, /The Reader is for Booker Stock Club members/, 'the /reader page refuses non-members');
  globalThis.__readerTest.auth = MEMBER;
  const allowed = await server_.ReaderPage({ params: Promise.resolve({ bookId: EPUB_ID }) });
  assert.equal(allowed.type.name, 'ReaderScreen', 'and shows members the book');

  assert.deepEqual(errors, []);
  console.log('Reader browser checks passed: row under News Feed, shelf with covers and progress, EPUB sandbox and sanitizing, edge clicks and arrow keys, contents, text size, sepia and Terminal themes, saved place restored after reload, PDF pages and bookmarks, phone swipes and taps, admin upload (with EPUB cover), hide, reorder, delete, and no access for non-members.');
} catch (e) { console.error(e); process.exitCode = 1; } finally { server.closeAllConnections(); await browser?.close(); await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); }
