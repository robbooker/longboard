// Actual reaction provider, popup, icons and CSS; synthetic HTTP only.
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(), port = Number(process.env.CHAT_TEST_PORT || 3352);
const targets = [
  { kind: 'room', room: 'main', messageId: 'public' },
  { kind: 'room', room: 'shortscout', messageId: 'shortscout' },
  { kind: 'dm', conversationId: 'private-conversation', messageId: 'private' },
  { kind: 'room', room: 'social', messageId: 'reply' },
];
const emojis = ['like', 'heart', 'laugh', 'rob'];
const source = `import React from 'react';import {createRoot} from 'react-dom/client';import Reactions,{MessageReactionProvider} from './components/chat/MessageReactions';const targets=${JSON.stringify(targets)};function App(){const [visible,setVisible]=React.useState(true);window.hideReactions=()=>setVisible(false);return <MessageReactionProvider><main>{targets.map(target=><article key={target.messageId}><header>{target.messageId}<span data-dm-reaction-host/></header><p>A message with reactions</p>{visible&&<Reactions target={target} compact={target.kind==='dm'}/>}</article>)}</main></MessageReactionProvider>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, write: false, outdir: resolve(root, '.reactions-review-fixture'), jsx: 'automatic', alias: { '@': root }, loader: { '.module.css': 'local-css' }, define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'updates-stub', setup(b) {
  b.onResolve({ filter: /^\.\/ChatUpdates$/ }, () => ({ path: 'updates', namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function useChatUpdates(){return null}', loader: 'js' }));
} }] });
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).contents, css = bundle.outputFiles.find(f => f.path.endsWith('.css')).contents, image = await readFile('public/chat/reactions/rob.png');
const names = ['A very long trader name '.repeat(5), 'Unbroken'.repeat(20), '<script>window.injected=true</script>', ...Array.from({ length: 52 }, (_, i) => `Trader ${i + 4}`)];
const details = [], mutations = [];
let scenario = 'normal';
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/_next/image') || req.url === '/chat/reactions/rob.png') { res.setHeader('Content-Type', 'image/png'); return res.end(image); }
  if (req.url === '/api/chat/message-reactions') {
    let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    if (body.action === 'details') {
      details.push(body);
      if (scenario === 'error' || (scenario === 'page-error' && body.after)) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'fixture failure' })); }
      const start = body.after ? 50 : 0;
      return res.end(JSON.stringify({ people: scenario === 'empty' ? [] : names.slice(start, scenario === 'single' ? 1 : start + 50).map((name, i) => ({ id: String(start + i), name })), nextCursor: ['empty', 'single'].includes(scenario) || body.after ? null : '49' }));
    }
    if (body.action === 'set') mutations.push(body);
    return res.end(JSON.stringify({ messages: Object.fromEntries((body.messageIds || [body.messageId]).map(id => [id, emojis.map(emoji => ({ emoji, count: 55, mine: false, names: [names[0]] }))])) }));
  }
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : req.url === '/bundle.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/bundle.js' ? js : req.url === '/bundle.css' ? css : '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>:root{--chat-text:#123;--chat-muted:#456;--chat-panel-raised:#fff;--chat-line:#bbb;--chat-palm:#087a48;--chat-palm-soft:#e2f4e8;--chat-error:#b00}body{margin:12px;font:14px system-ui;background:var(--chat-panel-raised);color:var(--chat-text)}main{min-height:1800px}article{border:1px solid var(--chat-line);padding:12px;margin-bottom:12px}header{display:flex;justify-content:space-between}body.dark{--chat-text:#eee;--chat-panel-raised:#182220;--chat-line:#53625b;--chat-palm:#64d49b;--chat-palm-soft:#224b36;--chat-error:#ff8b8b}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(r => server.listen(port, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message));
const pause = ms => new Promise(r => setTimeout(r, ms));
const chip = (target, emoji) => `[data-reaction-message="${target.messageId}"] button[aria-label^="Add ${emoji} reaction,"]`;
async function open(target, emoji, touch) {
  const selector = chip(target, emoji); await p.waitForSelector(selector); await p.$eval(selector, e => e.scrollIntoView({ block: 'center' }));
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (touch) {
    const point = await p.$eval(selector, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const cdp = await p.createCDPSession(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await pause(600); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  } else { await p.focus(selector); await p.keyboard.down('Shift'); await p.keyboard.press('F10'); await p.keyboard.up('Shift'); }
  try { await p.waitForSelector('dialog[open]', { timeout: 5000 }); } catch (error) { console.error('Could not open', target, emoji, await p.$eval(selector, e => ({ rect: e.getBoundingClientRect().toJSON(), disabled: e.disabled, active: e === document.activeElement, viewport: { width: innerWidth, height: innerHeight, scrollY } }))); await p.screenshot({ path: '/tmp/reactions-review-failure.png' }); throw error; }
}
async function close(target, emoji) { await p.keyboard.press('Escape'); await p.waitForSelector('dialog[open]', { hidden: true }); assert.equal(await p.$eval(chip(target, emoji), e => e === document.activeElement), true, 'focus returns to the original reaction'); }
async function button(text) {
  for (const button of await p.$$('dialog[open] button')) {
    if (await button.evaluate(e => e.textContent) !== text) continue;
    if (p.viewport()?.hasTouch) await button.tap(); else await button.click();
    return;
  }
  throw new Error(`Missing popup button: ${text}`);
}
async function verifyRows(target, emoji, count) {
  await p.waitForFunction(count => document.querySelectorAll('dialog[open] li').length === count, {}, count);
  const expected = emoji === 'heart' ? '❤️' : emoji === 'laugh' ? '😂' : target.kind === 'dm' ? '👍' : target.room === 'shortscout' ? '🍋' : '🌴';
  const rows = await p.$$eval('dialog[open] li', items => items.map(row => { const [name, icon] = row.children, r = row.getBoundingClientRect(), n = name.getBoundingClientRect(), i = icon.getBoundingClientRect(), img = icon.querySelector('img'), range = document.createRange(); range.selectNodeContents(icon); return { name: name.textContent, emoji: icon.textContent, image: img ? { src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 } : null, hidden: icon.getAttribute('aria-hidden'), nameLeft: n.left, nameRight: n.right, iconLeft: i.left, iconRight: i.right, symbolRight: (img ? img.getBoundingClientRect() : range.getBoundingClientRect()).right, iconWidth: i.width, rowRight: r.right }; }));
  assert.deepEqual(rows.map(r => r.name), names.slice(0, count), 'names remain full, ordered, and escaped');
  for (const row of rows) {
    assert(row.nameLeft < row.iconLeft && row.nameRight <= row.iconLeft, 'name left and icon right never overlap');
    assert(row.iconWidth >= 28 && row.iconWidth <= 40 && row.iconRight <= row.rowRight, 'icon has a bounded fixed column');
    assert.equal(row.iconLeft, rows[0].iconLeft, 'all rows align regardless of name length');
    assert(Math.abs(row.symbolRight - row.iconRight) < 1, 'emoji and custom image share the right edge of their fixed column');
    assert.equal(row.iconWidth, rows[0].iconWidth); assert.equal(row.hidden, 'true', 'repeated decorative icons do not repeat names to screen readers');
    if (emoji === 'rob') { assert(row.image?.loaded, 'actual Rob image loads in every row'); assert(row.image.src.includes('rob.png')); } else { assert.equal(row.emoji, expected); assert.equal(row.image, null); }
  }
  assert.equal(await p.evaluate(() => window.injected), undefined);
  assert(await p.$eval('dialog[open]', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth; }), 'popup fits narrow viewports');
  if (count > 5) assert(await p.$eval('[aria-label="People who reacted"]', e => e.scrollHeight > e.clientHeight), 'many names remain scrollable');
}
try {
  {
    await p.setViewport({ width: 320, height: 844, hasTouch: true, isMobile: true }); await p.goto(`http://127.0.0.1:${port}`);
    const selector = chip(targets[3], 'like'); await p.waitForSelector(selector);
    const point = await p.$eval(selector, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.evaluate(() => { window.pointerEvents = []; for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, event => window.pointerEvents.push({ type, tag: event.target.tagName, text: event.target.textContent.slice(0, 50), trusted: event.isTrusted }), true); });
    const cdp = await p.createCDPSession(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await pause(600);
    assert.deepEqual(await p.evaluate(point => ({ open: !!document.querySelector('dialog[open]'), underPointer: document.elementFromPoint(point.x, point.y)?.textContent }), point), { open: true, underPointer: 'Close' }, 'fixture reproduces Close appearing under the held finger');
    await p.screenshot({ path: '/tmp/reactions-review-overlap-before-release.png' });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pause(100);
    assert(await p.$('dialog[open]'), 'the same held gesture cannot click through to Close');
    assert(await p.evaluate(() => window.pointerEvents.some(event => event.type === 'click' && event.text === 'Close' && event.trusted)), 'native touch release actually targets Close');
    assert.equal(mutations.length, 0, 'opening hold does not toggle its reaction');
    await cdp.detach();
    await p.tap('dialog[open] > button'); await p.waitForSelector('dialog[open]', { hidden: true });
    assert.equal(await p.$eval(selector, e => e === document.activeElement), true, 'a fresh Close tap works and restores focus');
    await open(targets[3], 'like', false); await p.focus('dialog[open] > button'); await p.keyboard.press('Enter'); await p.waitForSelector('dialog[open]', { hidden: true });
    await open(targets[3], 'like', false); await p.mouse.click(1, 1); await p.waitForSelector('dialog[open]', { hidden: true });
    console.log('PASS overlapping native hold: release targets Close without dismissal; later Close tap, keyboard Close, and backdrop dismissal work');
  }
  for (const width of process.argv.includes('--overlap-only') ? [] : [320, 390, 1100]) {
    await p.setViewport({ width, height: 844, hasTouch: width < 500, isMobile: width < 500 }); await p.goto(`http://127.0.0.1:${port}`);
    await p.evaluate(dark => document.body.classList.toggle('dark', dark), width === 390);
    for (const target of targets) for (const emoji of emojis) {
      const before = details.length, writes = mutations.length; await open(target, emoji, width < 500); await verifyRows(target, emoji, 50);
      assert.deepEqual(details[before], { ...target, action: 'details', emoji, after: null }, 'request stays scoped to pressed reaction and target');
      await p.$eval('[aria-label="People who reacted"]', e => e.scrollTop = e.scrollHeight); await button('Load more'); await verifyRows(target, emoji, 55);
      assert.equal(details.length, before + 2, 'one request per page, never per person/icon'); assert.deepEqual(details[before + 1], { ...target, action: 'details', emoji, after: '49' });
      assert.equal(mutations.length, writes, 'hold/keyboard details never toggle reactions');
      if (target.messageId === 'public') { await p.$eval('[aria-label="People who reacted"]', e => e.scrollTop = 0); await p.screenshot({ path: `/tmp/reactions-review-${emoji}-${width}.png` }); }
      await close(target, emoji);
    }
    const target = targets[0], emoji = 'heart';
    scenario = 'single'; await open(target, emoji, false); await verifyRows(target, emoji, 1); await close(target, emoji);
    scenario = 'empty'; await open(target, emoji, false); await p.waitForFunction(() => document.querySelector('dialog[open]')?.textContent.includes('No reactions yet.')); assert.equal(await p.$$eval('dialog[open] li', e => e.length), 0); await close(target, emoji);
    scenario = 'error'; const retryStart = details.length; await open(target, emoji, false); await p.waitForSelector('dialog[open] [role="alert"]'); assert.equal(await p.$$eval('dialog[open] li', e => e.length), 0);
    scenario = 'normal'; await button('Try again'); await verifyRows(target, emoji, 50); assert.equal(details.length, retryStart + 2); await close(target, emoji);
    scenario = 'page-error'; await open(target, emoji, false); await verifyRows(target, emoji, 50); await button('Load more'); await p.waitForSelector('dialog[open] [role="alert"]'); await verifyRows(target, emoji, 50);
    scenario = 'normal'; await button('Try again'); await verifyRows(target, emoji, 55); await close(target, emoji);
    const writes = mutations.length; await p.click(chip(target, emoji)); await pause(100); assert.equal(mutations.length, writes + 1, 'ordinary click still toggles');
    const beforeCancel = details.length; await p.$eval(chip(target, emoji), e => { e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0, clientX: 20, clientY: 20 })); e.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, isPrimary: true, clientX: 20, clientY: 50 })); }); await pause(600); assert.equal(details.length, beforeCancel, 'scroll movement cancels a hold');
    await p.$eval(chip(target, emoji), e => { e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 })); e.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })); }); await pause(600); assert.equal(details.length, beforeCancel, 'pointer cancellation does not request names');
    console.log(`PASS ${width}px: all icons across room/SS/DM/reply; 55 names, fixed alignment, pagination/scope, long press/keyboard/focus, empty/error/retry, existing tap/cancel behavior`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
