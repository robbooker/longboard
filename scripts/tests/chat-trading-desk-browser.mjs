// #468 Trading Desk (mock-up, owner only): the real PublicChat sidebar and page, the real Quad pane
// and the real /api/chat/trading-desk route (bundled for Node, with sign-in stubbed). The data is the
// route's own sample data. Nothing leaves this machine and nothing talks to TradeZero.
//
// Checks: the owner (CHAT_OWNER_ACCOUNT_ID) has Trading Desk in the Apps section; it opens the desk
// with its Sample data badge, the read-only automation pill, "Updated …s ago from home computer",
// the account strip (day P&L first), positions with a totals row, open orders (every type, the range
// as low – high), and the activity newest first; there is no button anywhere in it; numbers are
// coloured with the look's own gain and loss colours in all five looks; the table headings stick;
// data over 30 seconds old turns amber; a phone (390 wide) has a 2-column strip, tables that scroll
// inside their frame with the symbol pinned and no sideways page scroll; the desk works on a Quad
// pane. Another admin, a member and a bot get no Trading Desk row, nothing opens at its address and
// its route answers 404.
//
// Usage: node scripts/tests/chat-trading-desk-browser.mjs [--shots <dir>]
//   --shots writes desk-desktop-{dark,light,paper,terminal}.png (2560x1440), desk-phone-top.png and
//   desk-phone-orders.png (390 wide @2x), desk-stale.png and sidebar-apps.png into <dir>.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const root = new URL('../../', import.meta.url).pathname, dir = join(root, 'node_modules', '.cache', `trading-desk-test-${process.pid}`);
await mkdir(dir, { recursive: true });
if (shots) await mkdir(shots, { recursive: true });

// Synthetic accounts. Only ROB's id is the configured owner.
const ROB_ID = '0000468a-0000-4000-8000-00000000000a';
process.env.CHAT_OWNER_ACCOUNT_ID = ROB_ID;
const ADMIN_ACCESS = { longboard: true, boardroom: true, shortscout: false, admin: true };
const ROB = { ok: true, user: { id: ROB_ID, email: 'rob@example.test', role: 'admin' }, access: ADMIN_ACCESS, serverSession: false };
const OTHER_ADMIN = { ok: true, user: { id: '0000468a-0000-4000-8000-00000000000b', email: 'admin@example.test', role: 'admin' }, access: ADMIN_ACCESS, serverSession: false };
const MEMBER = { ok: true, user: { id: '0000468a-0000-4000-8000-00000000000c', email: 'member@example.test', role: 'user' }, access: { longboard: true, boardroom: true, shortscout: false, admin: false }, serverSession: false };
const BOT = { ok: true, user: { id: ROB_ID, email: '', role: 'user' }, access: { longboard: false, shortscout: false, admin: false, botRooms: ['social'] }, serverSession: false, apiToken: true };
globalThis.__deskTest = { auth: ROB };

// The real route and app rules, with sign-in stubbed. Written under node_modules so `next` resolves.
await build({ stdin: { contents: `
  export * as desk from './app/api/chat/trading-desk/route';
  export { chatAppsFor } from './lib/chatApps.server';`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'server.mjs'), alias: { '@': root }, external: ['next', 'next/*'],
  plugins: [{ name: 'server-stubs', setup(b) {
    b.onResolve({ filter: /^next\/(server|navigation|headers)$/ }, (a) => ({ path: `${a.path}.js`, external: true }));
    b.onResolve({ filter: /^@\/lib\/chatAuth$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'ts', contents: 'export async function requireChatUser(){return globalThis.__deskTest.auth;}' }));
  } }] });
const server_ = await import(join(dir, 'server.mjs'));
const appsNow = () => server_.chatAppsFor(globalThis.__deskTest.auth);

const member = { id: '11111111-1111-4111-8111-1111111111aa', display_name: 'Rob', accepts_requests: true };
const roomState = { isOpen: true, notice: null, pausedAt: null, updatedAt: new Date().toISOString() };
const rooms = ['main', 'social', 'gainers'];
const messages = Object.fromEntries(rooms.map((room) => [room, [{ id: `m-${room}`, room_slug: room, member_id: null, guest_id: null, author_label: 'Bob', body: `Welcome to ${room}`, created_at: new Date(Date.now() - 60000).toISOString(), unread_seq: 1 }]]));
const bootstrap = { accountId: 'test-account', room: 'main', member, roomState, messages: [], reactions: [], counts: {}, featureChannel: false };
// The page's apps come from the server (lib/chatApps.server.ts) in production; here the test page asks /test/apps.
await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import PublicChat from './components/chat/PublicChat';import QuadChat from './components/chat/QuadChat';
  const q=new URLSearchParams(location.search);
  const apps=await (await fetch('/test/apps')).json();
  const props={accountId:'test-account',bootstrap:${JSON.stringify(bootstrap)},allowedRooms:${JSON.stringify(rooms)},serverSession:false,room:'main',fontVariableClass:'',appVersion:'test',apps,phoneList:q.has('list')};
  const Shell=location.pathname==='/chat/quad'?QuadChat:PublicChat;
  createRoot(document.getElementById('root')).render(<Shell {...props} popout={location.pathname!=='/chat'}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', outdir: dir, entryNames: 'bundle', alias: { '@': root }, loader: { '.module.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [{ name: 'test-platform', setup(b) {
    b.onResolve({ filter: /^(next\/(link|image|dynamic|navigation)|@\/lib\/supabase\/client)$/ }, (a) => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({ loader: 'tsx', resolveDir: root, contents:
      a.path === 'next/dynamic' ? `import React from 'react';export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={<p>Loading…</p>}><C {...props}/></React.Suspense>;}`
      : a.path === 'next/navigation' ? `export const useRouter=()=>({push:url=>location.href=url,refresh:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;`
      : a.path.includes('supabase') ? `export function createClient(){const channel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},track:async()=>{},presenceState:()=>({})};return {channel:()=>channel,removeChannel:()=>{},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`
      : `import React from 'react';export default function Component({children,unoptimized,fill,priority,scroll,prefetch,...props}){return React.createElement(${a.path === 'next/link' ? "'a'" : "'img'"},props,children);}` }));
  } }] });

const activity = { mentions: [], dms: [], mentionCount: 0, dmCount: 0, mentionThrough: 0, dmThrough: 0, roomCounts: {}, roomThrough: {}, roomMessageCounts: {}, roomMessageThrough: {} };
async function read(path) {
  const u = new URL(path, 'http://localhost'); const room = u.searchParams.get('room') || 'main';
  if (u.pathname === '/api/chat/quad-options') return { accountId: 'test-account', rooms, conversations: [], gainersTable: true, apps: await appsNow() };
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
  if (u.pathname === '/api/chat/gainers/table') return { day: '2026-11-19', rows: [] };
  return {};
}
// The site's IBM Plex Mono, as app/layout.tsx loads it (the desk's numbers use it).
const PLEX = [400, 500, 600].map((w) => `@font-face{font-family:"IBM Plex Mono";font-weight:${w};font-style:normal;src:url(/fonts/IBMPlexMono-${w}-latin.woff2) format("woff2")}`).join('');
// Set by the stale check: the desk's data is this much older than the route says.
let staleBy = 0;
const deskReads = [];
const body = async (req) => { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); };
const server = createServer(async (req, res) => {
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const url = new URL(req.url, 'http://x');
  if (['/chat', '/chat/quad'].includes(url.pathname)) { res.setHeader('Content-Type', 'text/html'); return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${PLEX}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script type="module" src="/bundle.js"></script>`); }
  if (['/bundle.js', '/bundle.css'].includes(url.pathname)) { res.setHeader('Content-Type', url.pathname.endsWith('css') ? 'text/css' : 'text/javascript'); return res.end(await readFile(join(dir, url.pathname.slice(1)))); }
  if (url.pathname.startsWith('/fonts/') && /^\/fonts\/IBMPlexMono-\d00-latin\.woff2$/.test(url.pathname)) { res.setHeader('Content-Type', 'font/woff2'); return res.end(await readFile(join(root, 'lib/fonts/ibm-plex-mono', url.pathname.slice(7)))); }
  if (url.pathname === '/chat-sw.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(''); }
  if (url.pathname === '/test/apps') return send(await appsNow());
  // The Trading Desk route, called as Next would call it.
  if (url.pathname === '/api/chat/trading-desk') {
    const response = await server_.desk[req.method]?.(new Request(base + req.url, { method: req.method }));
    if (!response) { res.writeHead(405); return res.end(); }
    deskReads.push(response.status);
    const text = await response.text();
    if (response.status === 200 && staleBy) {
      const data = JSON.parse(text); data.desk.updatedAt = new Date(Date.parse(data.desk.updatedAt) - staleBy).toISOString();
      return send(data);
    }
    res.writeHead(response.status, { 'Content-Type': 'application/json' }); return res.end(text);
  }
  if (url.pathname === '/api/chat/card-layout') return send({ layout: null, saved: false });
  if (req.method !== 'POST') return send(await read(req.url));
  const sent = JSON.parse((await body(req)).toString() || '{}');
  if (req.url === '/api/chat/updates') return send({ results: await Promise.all(sent.paths.map(async (path) => ({ path, status: 200, data: await read(path) }))) });
  if (req.url === '/api/chat/message-reactions') return send({ messages: {} });
  return send({});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const DESK = '[data-trading-desk][data-desk-state="ready"]';
const ROW = 'a[data-chat-app="trading-desk"]';
const THEME_KEY = 'longboard-public-chat-theme-v1';
const openDesk = async (p, theme) => {
  await p.evaluate((k, t) => localStorage.setItem(k, t), THEME_KEY, theme);
  await p.goto(`${base}/chat?page=trading-desk`); await p.waitForSelector(DESK, { timeout: 15000 });
  await p.evaluate(() => document.fonts.ready); await pause(250);
};
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const p = await browser.newPage(), errors = [];
  p.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('console:', m.text()); });
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(base + '/chat'); await p.evaluate((k) => localStorage.setItem(k, 'dark'), THEME_KEY);

  // 1. Rob: Trading Desk sits in the Apps section and opens the desk.
  await p.goto(base + '/chat'); await p.waitForSelector(ROW);
  assert.deepEqual(await p.$$eval('a[data-chat-app]', (a) => a.map((e) => e.dataset.chatApp)), ['reader', 'trading-desk'], 'Apps: the Reader, then the Trading Desk');
  assert.match(await p.$eval(ROW, (a) => a.textContent), /Trading Desk/);
  if (shots) {
    await p.setViewport({ width: 1440, height: 1000 });
    await pause(300);
    const nav = await p.$eval('[data-sidebar-group="apps"]', (h) => { const n = h.closest('nav') ?? h.parentElement; const r = n.getBoundingClientRect(); const a = h.getBoundingClientRect(); return { x: r.left, width: r.width, top: Math.max(0, a.top - 220), bottom: Math.min(innerHeight, a.bottom + 140) }; });
    await p.screenshot({ path: join(shots, 'sidebar-apps.png'), clip: { x: nav.x, y: nav.top, width: nav.width, height: nav.bottom - nav.top } });
    await p.setViewport({ width: 1440, height: 900 });
  }
  await p.click(ROW); await p.waitForSelector(DESK);
  assert.equal(await p.$eval(ROW, (a) => a.getAttribute('aria-current')), 'page');
  assert.match(p.url(), /[?&]page=trading-desk/, 'its address is /chat?page=trading-desk');

  // 2. What the desk shows.
  assert.equal(await p.$eval('[data-desk-sample]', (e) => e.textContent.trim()), 'Sample data');
  assert.equal(await p.$eval('[data-desk-automation]', (e) => e.textContent.trim()), 'Automated · Running');
  assert.equal(await p.$eval('[data-desk-automation]', (e) => e.tagName), 'SPAN', 'the automation pill only reports');
  assert.match(await p.$eval('[data-desk-updated]', (e) => e.textContent), /^Updated \ds ago from home computer$/);
  assert.equal(await p.$('[data-desk-stale]'), null, 'fresh data is not stale');
  assert.deepEqual(await p.$$eval('[data-desk-section]', (s) => s.map((e) => e.dataset.deskSection)), ['account', 'positions', 'orders', 'activity']);
  const strip = await p.$eval('[data-desk-section="account"]', (s) => s.innerText);
  for (const label of [/Day P&L/i, /Realized/, /Unrealized/, /Open P&L/i, /Equity/i, /Buying power/i, /Exposure/i, /Long/, /Short/]) assert.match(strip, label, `the strip has ${label}`);
  const hero = await p.$eval('[data-desk-section="account"] > div:first-child', (h) => ({ first: h.textContent.startsWith('Day P&L'), size: parseFloat(getComputedStyle(h.querySelector('[data-tone]')).fontSize) }));
  assert.ok(hero.first && hero.size >= 34, `the day P&L comes first and biggest (${hero.size}px)`);
  assert.equal(await p.$$eval('[data-desk-position]', (r) => r.length), 6, 'six positions');
  assert.match(await p.$eval('[data-desk-totals]', (r) => r.textContent), /Total.*6 positions/);
  assert.deepEqual([...new Set(await p.$$eval('[data-desk-order]', (r) => r.map((e) => e.dataset.deskOrder)))].sort(), ['Limit', 'Market', 'Range', 'Stop', 'Stop Limit']);
  assert.equal(await p.$eval('[data-desk-order="Range"] [data-desk-price]', (e) => e.textContent), '1.98 – 2.70', 'a range shows low – high');
  const tifs = await p.$$eval('[data-desk-order] td:nth-child(4)', (c) => c.map((e) => e.textContent));
  for (const tif of ['Day', 'Day+', 'GTC', 'GTC+']) assert.ok(tifs.includes(tif), `has ${tif}`);
  const times = await p.$$eval('[data-desk-activity] time', (t) => t.map((e) => Date.parse(e.dateTime)));
  assert.equal(times.length, 10, 'ten activity lines');
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  assert.equal(await p.$$eval('[data-trading-desk] button, [data-trading-desk] input, [data-trading-desk] select, [data-trading-desk] form', (b) => b.length), 0, 'nothing in the desk can trade, cancel or close');
  const sticky = await p.$$eval('[data-desk-section] thead th', (t) => t.every((e) => getComputedStyle(e).position === 'sticky'));
  assert.ok(sticky, 'table headings stick');
  const numbers = await p.$eval('[data-desk-position] td:nth-child(3)', (c) => ({ align: getComputedStyle(c).textAlign, figures: getComputedStyle(c).fontVariantNumeric }));
  assert.deepEqual(numbers, { align: 'right', figures: 'tabular-nums' }, 'numbers are right aligned with tabular figures');
  assert.match(await p.$eval('[data-desk-position] td:nth-child(3)', (c) => getComputedStyle(c).fontFamily), /^"IBM Plex Mono"/, 'numbers are monospace');
  assert.ok(await noSideScroll(p));

  // 3. Every look: gains and losses use the look's own colours. Screenshots at 2560x1440.
  const colours = async () => p.evaluate(() => {
    const page = document.querySelector('[data-theme]');
    const probe = (v) => { const s = document.createElement('span'); s.style.color = `var(${v})`; page.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
    return { theme: page.dataset.theme, up: getComputedStyle(document.querySelector('td [data-tone="up"]')).color, down: getComputedStyle(document.querySelector('td [data-tone="down"]')).color, success: probe('--chat-success'), error: probe('--chat-error') };
  });
  for (const [theme, shot] of [['dark', 'desk-desktop-dark.png'], ['light', 'desk-desktop-light.png'], ['paper-terminal', 'desk-desktop-paper.png'], ['terminal', 'desk-desktop-terminal.png'], ['blade-runner', null]]) {
    await p.setViewport({ width: 2560, height: 1440 });
    await openDesk(p, theme);
    const c = await colours();
    assert.equal(c.theme, theme);
    assert.equal(c.up, c.success, `${theme}: gains use the look's gain colour`);
    assert.equal(c.down, c.error, `${theme}: losses use the look's loss colour`);
    assert.notEqual(c.up, c.down);
    assert.ok(await noSideScroll(p), `${theme}: no sideways scroll`);
    // A computer: the activity is a column beside the tables.
    const side = await p.evaluate(() => { const t = document.querySelector('[data-desk-section="positions"]').getBoundingClientRect(), a = document.querySelector('[data-desk-section="activity"]').getBoundingClientRect(); return a.left > t.right && a.width < t.width; });
    assert.ok(side, `${theme}: activity is a narrower column beside the tables`);
    if (shots && shot) await p.screenshot({ path: join(shots, shot) });
  }

  // 4. Stale: data over 30 seconds old turns amber, with a note.
  staleBy = 125_000;
  await p.setViewport({ width: 2560, height: 1440 });
  await openDesk(p, 'dark');
  await p.waitForSelector('[data-desk-stale]');
  assert.match(await p.$eval('[data-desk-updated]', (e) => e.textContent), /Updated 2 min ago from home computer/);
  assert.match(await p.$eval('[data-desk-stale-note]', (e) => e.textContent), /out of date/);
  const amber = await p.evaluate(() => { const page = document.querySelector('[data-theme]'); const s = document.createElement('span'); s.style.color = 'var(--chat-draft)'; page.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return { want: c, got: getComputedStyle(document.querySelector('[data-desk-updated]')).color }; });
  assert.equal(amber.got, amber.want, 'the time turns the look\'s amber');
  if (shots) await p.screenshot({ path: join(shots, 'desk-stale.png') });
  staleBy = 0;

  // 5. A phone, 390 wide: 2-column strip, tables scroll inside their frames with the symbol pinned.
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await openDesk(p, 'dark');
  assert.ok(await noSideScroll(p), 'phone: no sideways page scroll');
  const phone = await p.evaluate(() => {
    const s = document.querySelector('[data-desk-section="account"]');
    const frame = document.querySelector('[data-desk-section="orders"] [tabindex]');
    return { columns: getComputedStyle(s).gridTemplateColumns.split(' ').length, scrolls: frame.scrollWidth > frame.clientWidth, symbol: getComputedStyle(frame.querySelector('tbody th')).position, deskRight: document.querySelector('[data-trading-desk]').getBoundingClientRect().right };
  });
  assert.equal(phone.columns, 2, 'phone: the strip is two columns');
  assert.ok(phone.scrolls, 'phone: the orders table scrolls inside its frame');
  assert.equal(phone.symbol, 'sticky', 'phone: the symbol stays pinned');
  assert.ok(phone.deskRight <= 391, 'phone: the desk fits the screen');
  if (shots) await p.screenshot({ path: join(shots, 'desk-phone-top.png') });
  await p.$eval('[data-desk-section="orders"]', (s) => s.scrollIntoView({ block: 'start' }));
  // Scrolled a little sideways, so the pinned symbol shows.
  await p.$eval('[data-desk-section="orders"] [tabindex]', (f) => { f.scrollLeft = 120; });
  await pause(250);
  const pinned = await p.$eval('[data-desk-section="orders"] [tabindex]', (f) => Math.round(f.querySelector('tbody th').getBoundingClientRect().left - f.getBoundingClientRect().left));
  assert.ok(pinned <= 2, `phone: the symbol stays at the left edge while the table scrolls (${pinned})`);
  assert.ok(await noSideScroll(p), 'phone: still no sideways page scroll');
  if (shots) await p.screenshot({ path: join(shots, 'desk-phone-orders.png') });
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  // 6. On a Quad pane.
  const pane = (i) => `section[aria-label^="Pane ${i}:"]`;
  await p.goto(base + '/chat/quad'); await p.waitForSelector(`${pane(2)} select`);
  assert.deepEqual(await p.$$eval(`${pane(2)} select optgroup[label="Apps"] option`, (o) => o.map((e) => e.value)), ['app:reader', 'app:trading-desk'], 'Trading Desk is a pane choice for Rob');
  await p.select(`${pane(2)} select`, 'app:trading-desk');
  await p.waitForSelector(`${pane(2)} ${DESK}`);
  const inPane = await p.$eval(pane(2), (s) => { const a = s.getBoundingClientRect(), b = s.querySelector('[data-trading-desk]').getBoundingClientRect(); return b.left >= a.left - 1 && b.right <= a.right + 1; });
  assert.ok(inPane, 'the desk stays inside its pane');
  assert.ok(await noSideScroll(p));

  // 7. Everyone else: no Trading Desk row, nothing opens at its address, the route says 404.
  for (const [who, auth] of [['another admin', OTHER_ADMIN], ['a member', MEMBER], ['a bot', BOT]]) {
    globalThis.__deskTest.auth = auth;
    const apps = await appsNow();
    assert.ok(!apps.includes('trading-desk'), `${who}: the server gives no Trading Desk`);
    const reads = deskReads.length;
    await p.goto(`${base}/chat?page=trading-desk`); await p.waitForSelector('nav'); await pause(600);
    assert.equal(await p.$(ROW), null, `${who}: no Trading Desk row`);
    assert.equal(await p.$('[data-trading-desk]'), null, `${who}: nothing opens at its address`);
    assert.equal(deskReads.length, reads, `${who}: the page doesn't even ask for it`);
    const response = await fetch(`${base}/api/chat/trading-desk`);
    assert.equal(response.status, 404, `${who}: the route refuses`);
    assert.deepEqual(await response.json(), { error: 'not_found' });
  }
  globalThis.__deskTest.auth = MEMBER;
  await p.goto(base + '/chat/quad'); await p.waitForSelector(`${pane(2)} select`);
  assert.deepEqual(await p.$$eval(`${pane(2)} select optgroup[label="Apps"] option`, (o) => o.map((e) => e.value)), ['app:reader'], 'a member has no Trading Desk pane');

  assert.deepEqual(errors, []);
  console.log('Trading Desk browser checks passed: Apps row for Rob, sample badge, read-only automation pill, account strip with day P&L first, positions with totals, every order type and time in force, range low – high, activity newest first, no controls, sticky headings, tabular right-aligned numbers, gain/loss colours in all five looks, amber stale state, phone strip and pinned symbols with no sideways scroll, Quad pane, and no row, no page and a 404 for another admin, a member and a bot.');
} catch (e) { console.error(e); process.exitCode = 1; } finally { server.closeAllConnections(); await browser?.close(); await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); }
