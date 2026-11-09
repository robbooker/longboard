// #385 Reader: the real PublicChat sidebar and library, the real reading screen (epub.js)
// and the real /api/chat/reader/* routes and /reader page (bundled for Node, with sign-in stubbed and
// an in-memory database and bucket from lib/__tests__/readerFakeDb.ts). The books are made by
// reader-fixture.mjs. Nothing leaves this machine.
//
// Checks: #406 the Reader row sits in its own Apps section below the rooms (not under Gainers) and
// opens the shelf (covers, titles, authors, "New");
// an EPUB opens full screen with its cover, chapters and contents; nothing active in the book runs
// (script, onerror, javascript: link) and its iframe is sandboxed without scripts; pages turn by
// clicking the edges and with the arrow keys; the contents list jumps to a chapter; the text gets
// bigger; Sepia and the chat's Terminal theme apply to the page; the place is saved to the account
// a moment later and a reload opens at the same place; the shelf shows the progress; #406 a PDF row
// is never listed or opened; a phone (390px) has Apps in its list, no sideways scroll and turns pages
// by swiping and tapping; #406 the Reader on a Quad pane and a Six card: the shelf, a book opened and
// read inside the pane (edge clicks, arrow keys only in the active pane), the place saved, Library
// back to the shelf; an admin's PDF is refused by Manage books (and the server), an EPUB (whose
// title, author and cover are read from the file) is added, hidden, reordered and deleted; a member
// with only the reader entitlement gets Apps; a bot account sees no Apps, is refused by every route
// and gets the members-only message on /reader.
//
// Usage: node scripts/tests/reader-browser.mjs [--shots <dir>]
//   --shots writes t385-shelf.png, t385-reading.png, t385-phone.png, t406-quad.png, t406-six.png and
//   t406-pdf-refused.png into <dir>.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer';
import { CHAPTERS, EPUB_AUTHOR, EPUB_TITLE, makeEpub, makePdf } from './reader-fixture.mjs';
const SECOND_TITLE = 'Longboard System Bible';
const args = process.argv.slice(2), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const root = new URL('../../', import.meta.url).pathname, dir = join(root, 'node_modules', '.cache', `reader-test-${process.pid}`);
await mkdir(dir, { recursive: true });

const EPUB_ID = '11111111-1111-4111-8111-111111111111', PDF_ID = '22222222-2222-4222-8222-222222222222', SECOND_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER = { ok: true, user: { id: 'acct-member', role: 'user' }, access: { longboard: true, boardroom: true, shortscout: false, admin: false } };
const ADMIN = { ok: true, user: { id: 'acct-admin', role: 'admin' }, access: { longboard: true, boardroom: true, shortscout: false, admin: true } };
// #406: everyone signed in has the Reader; only bot accounts don't.
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
  export { chatAppsFor } from './lib/chatApps.server';
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
// The page's apps come from the server (lib/chatApps.server.ts) in production; here from ?apps=.
await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import PublicChat from './components/chat/PublicChat';import QuadChat from './components/chat/QuadChat';import SixChat from './components/chat/SixChat';import ReaderView from './components/reader/ReaderView';
  const q=new URLSearchParams(location.search);
  const rooms=JSON.parse(q.get('rooms')||'null')||${JSON.stringify(rooms)};
  const apps=JSON.parse(q.get('apps')||'null')||['reader'];
  const props={accountId:'test-account',bootstrap:${JSON.stringify(bootstrap)},allowedRooms:rooms,serverSession:false,room:rooms.includes('main')?'main':rooms[0],fontVariableClass:'',appVersion:'test',apps,phoneList:q.has('list')};
  const book=location.pathname.startsWith('/reader/')?location.pathname.split('/')[2]:null;
  const Shell=location.pathname==='/chat/quad'?QuadChat:location.pathname==='/chat/six'?SixChat:PublicChat;
  createRoot(document.getElementById('root')).render(book?<ReaderView bookId={book}/>:<Shell {...props} popout={location.pathname!=='/chat'}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', outdir: dir, entryNames: 'bundle', alias: { '@': root }, loader: { '.module.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [{ name: 'test-platform', setup(b) {
    b.onResolve({ filter: /^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client)$/ }, (a) => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({ loader: 'tsx', resolveDir: root, contents:
      a.path === 'next/dynamic' ? `import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={<p>Loading…</p>}><C {...props}/></React.Suspense>;}`
      : a.path === 'next/navigation' ? `export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`
      : a.path.includes('supabase') ? `export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:()=>channel,removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`
      : `import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,prefetch,...props}){return React.createElement(${a.path === 'next/link' ? "'a'" : "'img'"},props,children);}` }));
  } }] });

const activity = { mentions: [], dms: [], mentionCount: 0, dmCount: 0, mentionThrough: 0, dmThrough: 0, roomCounts: {}, roomThrough: {}, roomMessageCounts: {}, roomMessageThrough: {} };
let sixSaved = null;
const appsNow = () => server_.chatAppsFor(globalThis.__readerTest.auth.user.id, globalThis.__readerTest.auth.access);
async function read(path) {
  const u = new URL(path, 'http://localhost'); const room = u.searchParams.get('room') || 'main';
  if (u.pathname === '/api/chat/quad-options') return { accountId: 'test-account', rooms, conversations: [], gainersTable: rooms.includes('gainers'), apps: await appsNow() };
  if (u.pathname === '/api/chat/app-version') return { version: 'test' };
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
  if (['/chat', '/chat/quad', '/chat/six'].includes(url.pathname) || url.pathname.startsWith('/reader/')) { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script type="module" src="/bundle.js"></script>'); }
  if (['/bundle.js', '/bundle.css'].includes(url.pathname)) { res.setHeader('Content-Type', url.pathname.endsWith('css') ? 'text/css' : 'text/javascript'); return res.end(await readFile(join(dir, url.pathname.slice(1)))); }
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
  // Six's saved cards, checked as the real route does (validateCardLayout is unit-tested).
  if (url.pathname === '/api/chat/card-layout') {
    if (req.method === 'GET') return send({ layout: sixSaved, saved: !!sixSaved });
    sixSaved = JSON.parse((await body(req)).toString()).layout; return send({ layout: sixSaved, saved: true });
  }
  if (req.method !== 'POST') return send(await read(req.url));
  const sent = JSON.parse((await body(req)).toString() || '{}');
  if (req.url === '/api/chat/updates') return send({ results: await Promise.all(sent.paths.map(async (path) => ({ path, status: 200, data: await read(path) }))) });
  if (req.url === '/api/chat/message-reactions') return send({ messages: {} });
  return send({});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;

// The shelf: an EPUB with its cover, a second EPUB without one, and (#406) a PDF row from before
// EPUB-only that must never be listed or opened.
const epub = await makeEpub(), pdf = makePdf(3);
const fake = server_.createReaderFakeDb({ reader_books: [
  { id: EPUB_ID, title: EPUB_TITLE, author: EPUB_AUTHOR, format: 'epub', storage_path: `books/${EPUB_ID}.epub`, cover_path: `covers/${EPUB_ID}.png`, byte_size: epub.length, sort: 1, hidden: false, ready: true, created_at: '2026-11-08T00:00:00Z' },
  { id: PDF_ID, title: 'Old PDF', author: 'Rob Booker', format: 'pdf', storage_path: `books/${PDF_ID}.pdf`, cover_path: null, byte_size: pdf.length, sort: 2, hidden: false, ready: true, created_at: '2026-11-08T00:00:00Z' },
  { id: SECOND_ID, title: SECOND_TITLE, author: 'Rob Booker', format: 'epub', storage_path: `books/${SECOND_ID}.epub`, cover_path: null, byte_size: epub.length, sort: 3, hidden: false, ready: true, created_at: '2026-11-08T00:00:00Z' },
] }, `${base}/storage`);
fake.files.set(`books/${EPUB_ID}.epub`, epub); fake.files.set(`books/${PDF_ID}.pdf`, pdf); fake.files.set(`books/${SECOND_ID}.epub`, epub);
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

  // 1. #406: the Reader sits in its own Apps section below the rooms (not under Gainers) and opens the shelf.
  const READER_ROW = 'a[data-chat-app="reader"]';
  await p.goto(base + '/chat'); await p.waitForSelector(READER_ROW);
  assert.equal(await p.$('a[data-chat-reader]'), null, 'no Reader row under Gainers any more');
  assert.equal(await p.$eval('a[data-chat-news-feed]', (a) => a.nextElementSibling?.matches('a[data-chat-app]') ?? false), false, 'nothing app-like under News Feed');
  const appsHeading = await p.$eval('[data-sidebar-group="apps"]', (h) => ({ text: h.textContent.trim(), next: h.nextElementSibling?.matches('a[data-chat-app="reader"]'), afterRooms: !!(h.compareDocumentPosition(document.querySelector('a[data-chat-news-feed]')) & Node.DOCUMENT_POSITION_PRECEDING) }));
  assert.deepEqual(appsHeading, { text: 'Apps', next: true, afterRooms: true }, 'an Apps heading below the rooms, with the Reader first');
  await p.click(READER_ROW); await p.waitForSelector('[data-reader-library] [data-reader-book]');
  assert.equal(await p.$eval(READER_ROW, (a) => a.getAttribute('aria-current')), 'page');
  const shelf = await p.$$eval('[data-reader-book]', (b) => b.map((e) => ({ id: e.dataset.readerBook, text: e.textContent, img: e.querySelector('img')?.src ?? null, href: e.querySelector('a').getAttribute('href') })));
  assert.deepEqual(shelf.map((b) => b.id), [EPUB_ID, SECOND_ID], 'the PDF row is never listed');
  assert.match(shelf[0].text, new RegExp(`${EPUB_TITLE}.*${EPUB_AUTHOR}.*New`));
  assert.ok(shelf[0].img?.includes(`/storage/signed/covers/${EPUB_ID}.png`), 'the cover comes through a signed link');
  assert.equal(shelf[1].img, null, 'a book without a cover gets a plain one');
  assert.equal((await fetch(`${base}/api/chat/reader/books/${PDF_ID}`)).status, 404, 'the PDF row never opens');
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

  // 8. #406: /reader/<id> of a PDF row says it isn't on the shelf; nothing is drawn.
  await p.goto(`${base}/reader/${PDF_ID}`); await p.waitForSelector('[data-reader-status="error"]');
  assert.match(await p.$eval('[data-reader-status="error"]', (e) => e.textContent), /isn.t on the shelf/);
  assert.equal(await p.$('[data-reader-host] canvas, [data-reader-host] iframe'), null);

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
  // #406: the phone's list has the Apps section too, and its Reader row opens the shelf.
  await p.goto(base + '/chat?list'); await p.waitForSelector(READER_ROW, { visible: true });
  assert.equal(await p.$eval('[data-sidebar-group="apps"]', (h) => h.textContent.trim()), 'Apps');
  if (shots) { await pause(300); await p.screenshot({ path: join(shots, 't406-phone-nav.png') }); }
  await p.tap(READER_ROW); await p.waitForSelector('[data-reader-library] [data-reader-book]', { visible: true });
  await p.setViewport({ width: 1280, height: 860, isMobile: false, hasTouch: false });

  // 9b. #406: the Reader on a Quad pane: the shelf, a book read inside the pane, keys only in the active pane.
  await p.setViewport({ width: 1440, height: 900 });
  const pane = (i) => `section[aria-label^="Pane ${i}:"]`;
  await p.goto(base + '/chat/quad'); await p.waitForSelector(`${pane(2)} select`);
  assert.deepEqual(await p.$$eval(`${pane(2)} select optgroup[label="Apps"] option`, (o) => o.map((e) => [e.value, e.textContent])), [['app:reader', 'Reader']], 'Reader is a pane choice, under Apps');
  await p.select(`${pane(2)} select`, 'app:reader');
  await p.waitForSelector(`${pane(2)} [data-reader-book="${SECOND_ID}"]`);
  assert.equal(await p.$(`${pane(2)} [data-reader-book="${PDF_ID}"]`), null, 'no PDF in the pane either');
  const urlBefore = p.url();
  await p.click(`${pane(2)} [data-reader-book="${SECOND_ID}"] a`);
  await p.waitForSelector(`${pane(2)} [data-reader][data-reader-pane] [data-reader-next]`, { timeout: 15000 });
  assert.equal(p.url(), urlBefore, 'the book opens inside the pane, not on its own page');
  const inPane = await p.$eval(pane(2), (s) => { const a = s.getBoundingClientRect(), b = s.querySelector('[data-reader]').getBoundingClientRect(); return b.left >= a.left - 1 && b.right <= a.right + 1 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1; });
  assert.ok(inPane, 'the reading screen stays inside its pane');
  assert.equal(await p.$$eval('section[aria-label^="Pane "]:not([hidden])', (e) => e.length), 4, 'the other panes are still there');
  const paneLoc = () => p.$eval(`${pane(2)} [data-reader]`, (e) => e.dataset.readerLocation ?? '');
  await p.waitForFunction((s) => document.querySelector(s)?.dataset.readerLocation, {}, `${pane(2)} [data-reader]`);
  const q0 = await paneLoc();
  await p.click(`${pane(2)} [data-reader-next]`);
  await p.waitForFunction((s, was) => document.querySelector(s).dataset.readerLocation !== was, {}, `${pane(2)} [data-reader]`, q0);
  const q1 = await paneLoc();
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction((s, was) => document.querySelector(s).dataset.readerLocation !== was, {}, `${pane(2)} [data-reader]`, q1);
  const q2 = await paneLoc();
  // Another pane becomes active: the arrow keys no longer turn the book's pages.
  await p.$eval(pane(1), (e) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press('ArrowRight'); await pause(600);
  assert.equal(await paneLoc(), q2, 'arrow keys only turn pages in the active pane');
  await waitSaved(SECOND_ID, (r) => r.location === q2, 'place saved from the Quad pane');
  if (shots) { await pause(300); await p.screenshot({ path: join(shots, 't406-quad.png') }); }
  await p.click(`${pane(2)} [data-reader-back]`); await p.waitForSelector(`${pane(2)} [data-reader-book="${SECOND_ID}"] [data-reader-percent]`);
  assert.notEqual(await p.$eval(`${pane(2)} [data-reader-book="${SECOND_ID}"] [data-reader-percent]`, (e) => e.textContent), 'New', 'Library goes back to the shelf with the progress');
  await p.reload(); await p.waitForSelector(`${pane(2)} [data-reader-book]`);
  assert.equal(await p.$eval(`${pane(2)} select`, (e) => e.value), 'app:reader', 'the Reader pane is kept');

  // 9c. #406: the Reader on a Six card: picked as Apps → Reader; reopening the book goes to the saved place.
  await p.setViewport({ width: 1920, height: 1080 });
  const card = (i) => `section[data-card="${i}"]`;
  await p.goto(base + '/chat/six'); await p.waitForSelector(card(6)); await p.waitForFunction(() => !document.body.textContent.includes('Loading your cards'));
  // A first Six starts from the Quad panes, the Reader pane included; move it to card 6 by hand.
  const seeded = await p.$$eval('section[data-card]', (c) => c.map((e) => e.dataset.cardType));
  assert.equal(seeded[1], 'app', `Quad's Reader pane comes along to Six: ${seeded}`);
  await p.click(`${card(2)} button[aria-label="Remove card 2"]`);
  const slot = await p.$(`${card(6)} button[aria-label="Remove card 6"]`); if (slot) await slot.click();
  await p.click(`${card(6)} button[aria-label="Choose card 6"]`); await p.waitForSelector(`${card(6)} [data-card-picker]`);
  await p.click(`${card(6)} [data-card-picker] input[value="app"]`);
  await p.waitForFunction((s) => document.querySelector(s)?.value === 'reader', {}, `${card(6)} [data-card-picker] select`);
  assert.deepEqual(await p.$$eval(`${card(6)} [data-card-picker] select option`, (o) => o.map((e) => e.value).filter(Boolean)), ['reader'], 'Apps offers the Reader');
  await p.click(`${card(6)} [data-card-picker] button[type=submit]`);
  await p.waitForSelector(`${card(6)} [data-card-reader] [data-reader-book="${SECOND_ID}"]`);
  assert.deepEqual(sixSaved[5], { type: 'app', source: 'reader' }, 'the card is saved');
  await p.click(`${card(6)} [data-reader-book="${SECOND_ID}"] a`);
  // It opens at the place saved from the Quad pane (the same chapter; the page edge differs with the card's size).
  await p.waitForFunction((s) => document.querySelector(s)?.dataset.readerLocation, { timeout: 15000 }, `${card(6)} [data-reader]`);
  const sixLoc = await p.$eval(`${card(6)} [data-reader]`, (e) => e.dataset.readerLocation);
  assert.equal(sixLoc.split('!')[0], q2.split('!')[0], `opens in the saved chapter (${q2} → ${sixLoc})`);
  assert.notEqual(sixLoc, q0, 'not back at the start');
  if (shots) { await pause(300); await p.screenshot({ path: join(shots, 't406-six.png') }); }
  await p.setViewport({ width: 1280, height: 860 });

  // 10. An admin's PDF is refused; an EPUB is added, hidden, reordered and deleted.
  globalThis.__readerTest.auth = ADMIN;
  await p.goto(base + '/chat?page=reader'); await p.waitForSelector('[data-reader-manage]');
  await p.click('[data-reader-manage]'); await p.waitForSelector('[data-reader-upload]');
  await writeFile(join(dir, 'Club Notes.pdf'), makePdf(2)); await writeFile(join(dir, 'fables.epub'), epub);
  // #406: the picker offers EPUBs only; a PDF picked anyway is refused at once and cleared.
  assert.equal(await p.$eval('[data-reader-file]', (e) => e.accept), '.epub,application/epub+zip');
  const booksBefore = fake.tables.reader_books.length;
  await (await p.$('[data-reader-file]')).uploadFile(join(dir, 'Club Notes.pdf'));
  await p.waitForSelector('[data-reader-admin-message]');
  assert.match(await p.$eval('[data-reader-admin-message]', (e) => e.textContent), /Only EPUB books can be added/);
  assert.equal(await p.$eval('[data-reader-file]', (e) => e.files.length), 0, 'the PDF is cleared from the picker');
  assert.equal(await p.$eval('[data-reader-submit]', (b) => b.disabled), true, 'nothing to add');
  if (shots) { await p.evaluate(() => document.querySelector('[data-reader-admin]').scrollIntoView({ block: 'start' })); await pause(300); await p.screenshot({ path: join(shots, 't406-pdf-refused.png') }); }
  // The server refuses one too, should anything send it.
  const refused = await p.evaluate(async () => { const r = await fetch('/api/chat/reader/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Club Notes', format: 'pdf', byteSize: 10 }) }); return { status: r.status, body: await r.json() }; });
  assert.deepEqual(refused, { status: 415, body: { error: 'epub_only', message: 'Only EPUB books can be added to the Reader.' } });
  assert.equal(fake.tables.reader_books.length, booksBefore, 'no PDF row was made');
  // The EPUB's own title, author and cover are filled in.
  await (await p.$('[data-reader-file]')).uploadFile(join(dir, 'fables.epub'));
  await p.waitForFunction((t) => document.querySelector('[data-reader-title]').value === t, {}, EPUB_TITLE);
  assert.equal(await p.$eval('[data-reader-author]', (e) => e.value), EPUB_AUTHOR);
  await p.waitForSelector('[data-reader-admin] img');
  await p.click('[data-reader-submit]');
  await p.waitForFunction(() => /is on the shelf/.test(document.querySelector('[data-reader-admin-message]')?.textContent ?? ''), { timeout: 10000 });
  const second = fake.tables.reader_books.filter((b) => b.title === EPUB_TITLE).find((b) => b.id !== EPUB_ID);
  assert.ok(second?.ready && second.cover_path?.endsWith('.png') && fake.files.has(second.cover_path), 'the EPUB came with its own cover');
  const added = second;
  // Hide: members no longer see it.
  await p.click(`[data-reader-manage-row="${added.id}"] [data-reader-hide]`);
  await p.waitForFunction((id) => document.querySelector(`[data-reader-book="${id}"]`)?.hasAttribute('data-hidden'), {}, added.id);
  globalThis.__readerTest.auth = MEMBER;
  assert.ok(!(await (await fetch(`${base}/api/chat/reader/books`)).json()).books.some((b) => b.id === added.id), 'hidden from members');
  assert.equal((await fetch(`${base}/api/chat/reader/books/${added.id}`)).status, 404);
  globalThis.__readerTest.auth = ADMIN;
  await p.click(`[data-reader-manage-row="${added.id}"] [data-reader-hide]`);
  await p.waitForFunction((id) => !document.querySelector(`[data-reader-book="${id}"]`)?.hasAttribute('data-hidden'), {}, added.id);
  // Reorder: move the second book to the top.
  await p.click(`[data-reader-manage-row="${SECOND_ID}"] [data-reader-up]`);
  await p.waitForFunction((id) => document.querySelector('[data-reader-book]')?.dataset.readerBook === id, {}, SECOND_ID);
  // Delete.
  p.once('dialog', (d) => d.accept());
  await p.click(`[data-reader-manage-row="${second.id}"] [data-reader-delete]`);
  await p.waitForFunction((id) => !document.querySelector(`[data-reader-book="${id}"]`), {}, second.id);
  assert.ok(!fake.files.has(second.storage_path) && !fake.tables.reader_books.some((b) => b.id === second.id), 'deleted with its file');

  // 11. #406: every member has the Reader; a bot account has no Apps, every route refuses, the page says members only.
  globalThis.__readerTest.auth = OUTSIDER;
  for (const [path, method] of [['/api/chat/reader/books', 'GET'], [`/api/chat/reader/books/${EPUB_ID}`, 'GET'], ['/api/chat/reader/progress', 'PUT'], ['/api/chat/reader/books', 'POST']])
    assert.equal((await fetch(base + path, { method, ...(method !== 'GET' ? { body: '{}' } : {}) })).status, 403, `${method} ${path} refused`);
  // #384/#406: a club member with only the "reader" entitlement (no Gainers room) gets Apps and the shelf.
  const CLUB = { ok: true, user: { id: 'acct-club', role: 'user' }, access: { longboard: false, shortscout: false, admin: false, member: ['reader'] } };
  globalThis.__readerTest.auth = CLUB;
  assert.equal((await fetch(`${base}/api/chat/reader/books`)).status, 200, 'reader entitlement opens the shelf');
  assert.deepEqual(await server_.chatAppsFor(CLUB.user.id, CLUB.access), ['reader'], 'the server gives a reader-only member the Reader app');
  await p.goto(base + '/chat?rooms=' + encodeURIComponent(JSON.stringify(['club'])) + '&apps=' + encodeURIComponent(JSON.stringify(['reader']))); await p.waitForSelector(READER_ROW);
  assert.equal(await p.$('a[data-chat-gainers-table]'), null, 'no Gainers rows, but the Reader is there');
  await p.click(READER_ROW); await p.waitForSelector('[data-reader-library] [data-reader-book]');
  globalThis.__readerTest.auth = OUTSIDER;
  assert.deepEqual(await server_.chatAppsFor(OUTSIDER.user.id, OUTSIDER.access), [], 'bots get no apps');
  rooms = ['social'];
  await p.goto(base + '/chat?page=reader&apps=[]&rooms=' + encodeURIComponent(JSON.stringify(rooms))); await p.waitForSelector('nav'); await pause(400);
  assert.equal(await p.$(READER_ROW), null, 'no Reader row without access');
  assert.equal(await p.$('[data-sidebar-group="apps"]'), null, 'no Apps section without apps');
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
  console.log('Reader browser checks passed: Apps section (desktop and phone), shelf with covers and progress, EPUB sandbox and sanitizing, edge clicks and arrow keys, contents, text size, sepia and Terminal themes, saved place restored after reload, no PDF ever listed or opened, phone swipes and taps, Reader in a Quad pane and a Six card, PDF upload refused, admin EPUB upload (with cover), hide, reorder, delete, reader-only member, and no access for bots.');
} catch (e) { console.error(e); process.exitCode = 1; } finally { server.closeAllConnections(); await browser?.close(); await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); }
