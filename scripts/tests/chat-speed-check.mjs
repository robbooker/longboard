#!/usr/bin/env node
// Chat speed check (phone): a production build of /chat on a 390px phone with the CPU slowed 4x,
// against the synthetic chat-mobile-fixture. Reports numbers; it does not pass or fail on them.
//
// Measures, for the first load and for each room tap (open Social, back to LB, Social again):
//   tap_to_frame   pointerdown -> the first frame after the new room's composer is on screen (ms)
//   inp            the slowest Event Timing entry for the tap (what Chrome's INP would count, ms)
//   long_tasks     main-thread tasks over 50 ms in that window: count and total ms
//
// Needs a finished `next build` made with the synthetic env below (the fixture's ports are baked
// into the client), /usr/bin/chromium (or CHROMIUM_PATH), and ports 3204 and 54404 free.
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54404 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role NEXT_PUBLIC_SITE_URL=http://localhost:3204 npx next build
//   node scripts/tests/chat-speed-check.mjs [--runs 3] [--out speed.json]
// Every value here is synthetic; no production key ever belongs in this file.
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';

const root = resolve(new URL('../..', import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const RUNS = Number(opt('--runs', 3));
const OUT = opt('--out', null);
const LOGDIR = opt('--logs', '/tmp');
const APP = 'http://localhost:3204';
export const SPEED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54404', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', NEXT_PUBLIC_SITE_URL: APP, NEXT_TELEMETRY_DISABLED: '1',
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listening = port => new Promise(r => { const s = connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); r(true); }); s.once('error', () => r(false)); });
async function until(check, seconds) { for (let i = 0; i < seconds * 4; i++) { if (await check()) return true; await sleep(250); } return false; }
const children = [];
function start(cmd, argv, env, log) {
  const fd = openSync(log, 'w');
  const c = spawn(cmd, argv, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], detached: true });
  closeSync(fd); children.push(c); return c;
}
const stopAll = () => { for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch {} } };
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

async function session(browser) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await page.evaluateOnNewDocument(() => {
    window.__long = []; window.__events = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.interactionId) window.__events.push([e.startTime, e.duration, e.name]); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch {}
  });
  const cdp = await page.createCDPSession();
  // Sign in at full speed; only the measured part runs throttled.
  await page.goto(`${APP}/login?next=%2Fchat`); await page.waitForSelector('#li-email'); await page.reload({ waitUntil: 'networkidle0' });
  await page.type('#li-email', 'alice@example.test'); await page.type('#li-password', 'demo-only'); await page.click('button[type="submit"]');
  await page.waitForSelector('textarea[aria-label="Message LB"]');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // First load of /chat.
  await page.goto(`${APP}/chat`, { waitUntil: 'load' });
  await page.waitForFunction(() => { const t = document.querySelector('textarea[aria-label="Message LB"]'); return t && Object.keys(t).some(k => k.startsWith('__reactProps')); });
  await page.waitForSelector('[role="log"] [id^="chat-message-"]');
  await page.waitForFunction(n => { const e = document.querySelector(n); return e && getComputedStyle(e).visibility === 'visible'; }, {}, 'nav[aria-label="Chat rooms"]');
  const load = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const long = window.__long.filter(([s]) => s <= performance.now());
    r({ ready: Math.round(performance.now()), domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0), long_tasks: long.length, long_ms: Math.round(long.reduce((n, [, d]) => n + d, 0)) });
  }))));
  await sleep(1500);

  // One room tap on the phone home screen (the room list): go back to the list if a room is open,
  // tap the room, then wait until the room is on screen (list hidden, the room's composer there)
  // and the frame after that.
  const NAV = 'nav[aria-label="Chat rooms"]', ROOM = 'section[aria-label="Longboard Chat"]';
  async function tap(href, label) {
    const back = 'button[aria-label="Back to all chats"]';
    if (await page.$eval(ROOM, r => !r.inert).catch(() => false) && await page.$(back)) {
      await page.tap(back);
      await page.waitForFunction(r => document.querySelector(r).inert, {}, ROOM);
    }
    await page.waitForSelector(`${NAV} a[href="${href}"]`, { visible: true });
    await sleep(600);
    await page.evaluate((nav, room, sel) => {
      const s = window.__speed = { start: null, end: null };
      addEventListener('pointerdown', e => { s.start ??= e.timeStamp; }, { capture: true, once: true });
      const shown = () => {
        const r = document.querySelector(room), n = document.querySelector(nav), t = document.querySelector(sel);
        return r && !r.inert && n && getComputedStyle(n).visibility === 'hidden' && t && t.getClientRects().length > 0;
      };
      const check = () => { if (s.start !== null && shown()) requestAnimationFrame(() => { s.end = performance.now(); }); else requestAnimationFrame(check); };
      requestAnimationFrame(check);
    }, NAV, ROOM, `textarea[aria-label="${label}"]`);
    await page.tap(`${NAV} a[href="${href}"]`);
    await page.waitForFunction(() => window.__speed.end !== null);
    await sleep(1200); // let Event Timing entries and trailing long tasks arrive
    return page.evaluate(() => {
      const { start, end } = window.__speed, until = end + 1000;
      const long = window.__long.filter(([s]) => s >= start - 5 && s <= until);
      const ev = window.__events.filter(([s]) => s >= start - 5 && s <= until);
      return { tap_to_frame: Math.round(end - start), inp: ev.length ? Math.round(Math.max(...ev.map(e => e[1]))) : null, long_tasks: long.length, long_ms: Math.round(long.reduce((n, [, d]) => n + d, 0)) };
    });
  }
  const steps = {
    room_open: await tap('/chat?room=social', 'Message Social'),
    room_switch_back: await tap('/chat?room=main', 'Message LB'), // via Back, then LB
    room_switch_again: await tap('/chat?room=social', 'Message Social'),
  };
  await context.close();
  return { load, ...steps };
}

let browser;
try {
  if (await listening(3204) || await listening(54404)) throw Error('port 3204 or 54404 is already in use');
  start(process.execPath, ['scripts/tests/chat-mobile-fixture.mjs'], {}, `${LOGDIR}/chat-speed-fixture.log`);
  if (!await until(() => listening(54404), 180)) throw Error('fixture did not start');
  start(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3204'], SPEED_ENV, `${LOGDIR}/chat-speed-next.log`);
  if (!await until(async () => { try { return (await fetch(`${APP}/login`)).ok; } catch { return false; } }, 120)) throw Error('next start did not answer');
  browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  await session(browser); // warm-up: server caches and the fixture's first queries
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await session(browser));
  const keys = ['load', 'room_open', 'room_switch_back', 'room_switch_again'];
  const summary = Object.fromEntries(keys.map(k => [k, Object.fromEntries(Object.keys(runs[0][k]).map(m => [m, median(runs.map(r => r[k][m]).filter(v => v !== null))]))]));
  const result = { viewport: '390x844', cpuThrottle: 4, runs: RUNS, median: summary, raw: runs };
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
  const md = ['### Chat speed check (phone, 390px, CPU 4x slower)', '',
    `Median of ${RUNS} runs against the synthetic fixture on a production build. Report only; nothing fails on these numbers yet.`, '',
    '| Step | Tap to frame | INP-like (slowest event) | Long tasks | Long-task time |', '|---|---|---|---|---|',
    `| First load of /chat (ready) | ${summary.load.ready} ms | | ${summary.load.long_tasks} | ${summary.load.long_ms} ms |`,
    ...keys.slice(1).map(k => `| ${k.replaceAll('_', ' ')} | ${summary[k].tap_to_frame} ms | ${summary[k].inp ?? '-'} ms | ${summary[k].long_tasks} | ${summary[k].long_ms} ms |`), ''].join('\n');
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
} finally {
  await browser?.close();
  stopAll();
}
