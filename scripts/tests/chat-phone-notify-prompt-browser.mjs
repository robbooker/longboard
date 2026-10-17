// PHONE-NOTIFY-PROMPT: on a phone, while push notifications are not set up on this device, the
// list's top bar and the conversation header show a bell with a slash. It opens Phone
// notifications, or short steps when the site cannot turn them on by itself (an iPhone Safari tab,
// permission denied); "Not now" hides it for 30 days; it hides itself once notifications are on;
// a computer never shows it. Notification, permissions, the service worker and its push manager
// are faked in the page — no real push service, permission prompt or server push request.
// Run with the shared chat fixture (chat-mobile-fixture.mjs). Exclusively synthetic local data.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.CHAT_TEST_URL || 'http://localhost:3399';
const shots = process.env.PNP_SHOTS || '';
if (shots) await mkdir(shots, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];
const composer = 'textarea[aria-label="Message LB"]', nav = 'nav[aria-label="Chat rooms"]';
const icon = 'button[data-push-prompt]';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true }, DESKTOP = { width: 1440, height: 1000 };

function fake(o) {
  const state = (window.testPush = { permission: o.permission ?? 'default', subscribed: !!o.subscribed, requests: 0 });
  if (o.theme) localStorage.setItem('longboard-public-chat-theme-v1', o.theme);
  if (o.owner) localStorage.setItem('longboard.chat.push-owner.v1', JSON.stringify({ accountId: o.owner, endpoint: 'https://push.example.test/device' }));
  if (o.iphone) {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1' });
    Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
    // A Safari tab has no web push at all.
    delete window.PushManager; delete window.Notification;
    return;
  }
  const subscription = { endpoint: 'https://push.example.test/device', toJSON: () => ({ endpoint: 'https://push.example.test/device', keys: { p256dh: 'test', auth: 'test' } }), unsubscribe: async () => { state.subscribed = false; return true; } };
  const registration = { scope: location.origin + '/chat', active: { scriptURL: location.origin + '/chat-sw.js' }, waiting: null, update: async () => {},
    pushManager: { getSubscription: async () => { state.requests++; return state.subscribed ? subscription : null; }, subscribe: async () => { state.subscribed = true; return subscription; } } };
  const workerEvents = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { addEventListener: (...a) => workerEvents.addEventListener(...a), removeEventListener: (...a) => workerEvents.removeEventListener(...a), getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) } });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, 'Notification', { configurable: true, value: { get permission() { return state.permission; }, requestPermission: async () => (state.permission = 'granted') } });
  const status = new EventTarget();
  Object.defineProperty(status, 'state', { get: () => (state.permission === 'default' ? 'prompt' : state.permission) });
  window.testPermission = status;
  const query = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (d) => (d?.name === 'notifications' ? Promise.resolve(status) : query(d));
}

/** The prompt icons a person can see: kept rooms (SHELL-KEEP) and the covered screen don't count. */
const visibleIcons = (page) => page.$$eval(icon, (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).visibility === 'visible' && r.left >= 0 && r.right <= innerWidth; }).map((e) => ({ state: e.dataset.pushPrompt, label: e.getAttribute('aria-label'), inNav: !!e.closest('nav'), inHeader: !!e.closest('section header') })));
const waitIcons = (page, n) => page.waitForFunction((sel, n) => [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).visibility === 'visible' && r.left >= 0 && r.right <= innerWidth; }).length === n, { timeout: 15000 }, icon, n);
const reactReady = (page, s) => page.waitForFunction((s) => { const e = document.querySelector(s); return e && Object.keys(e).some((k) => k.startsWith('__reactProps')); }, { timeout: 30000 }, s);
async function tapVisible(page, selector) {
  const handle = await page.evaluateHandle((s) => [...document.querySelectorAll(s)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).visibility === 'visible' && r.left >= 0 && r.right <= innerWidth; }), selector);
  const el = handle.asElement(); assert.ok(el, 'visible ' + selector); await el.tap();
}
async function open(options, path = '/chat', viewport = PHONE) {
  const page = await browser.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(fake, options);
  await page.goto(base + path); await reactReady(page, composer);
  return page;
}
const shot = (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

try {
  {
    const page = await browser.newPage();
    await page.goto(`${base}/login?next=%2Fchat`); await page.waitForSelector('#li-email'); await page.reload({ waitUntil: 'networkidle0' });
    await page.type('#li-email', 'alice@example.test'); await page.type('#li-password', 'demo-only'); await page.click('button[type="submit"]');
    await page.waitForSelector(composer); await page.close();
  }

  for (const theme of ['light', 'dark']) {
    // 1. Not set up: the list's top bar shows the icon beside the bell and •••.
    const page = await open({ theme });
    await waitIcons(page, 1);
    let shown = await visibleIcons(page);
    assert.deepEqual(shown, [{ state: 'settings', label: 'Phone notifications are off', inNav: true, inHeader: false }], JSON.stringify(shown));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(page, `room-list-${theme}-after`);

    // 2. A conversation: the icon sits before info, and the title stays centered.
    await tapVisible(page, `${nav} a[href="/chat?room=main"]`);
    // The list slides away (visibility: hidden) once the conversation is on screen.
    await page.waitForFunction((n) => { const s = document.querySelector('section[aria-label="Longboard Chat"]'); return s && !s.inert && getComputedStyle(s).visibility === 'visible' && getComputedStyle(document.querySelector(n)).visibility === 'hidden'; }, { timeout: 15000 }, nav);
    await waitIcons(page, 1);
    shown = await visibleIcons(page);
    assert.equal(shown[0].inHeader, true, JSON.stringify(shown));
    const header = await page.$eval('section[aria-label="Longboard Chat"] header[data-phone]', (h) => ({ buttons: [...h.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')), centered: (() => { const r = h.querySelector('h1').getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - innerWidth / 2); })() }));
    assert.deepEqual(header.buttons, ['Back to all chats', 'Phone notifications are off', 'Room info'], header.buttons.join(' | '));
    assert.ok(header.centered < 4, 'title centered: ' + header.centered);
    await pause(300); await shot(page, `conversation-${theme}-after`);

    // 3. Tapping it opens the existing Phone notifications settings, with "Not now".
    await tapVisible(page, icon);
    await page.waitForSelector('dialog[open] h2');
    assert.equal(await page.$eval('dialog[open] h2', (e) => e.textContent), 'Phone notifications');
    await page.waitForFunction(() => ![...document.querySelectorAll('dialog[open] [role=status]')].some((e) => e.textContent === 'Working…'));
    assert.ok(await page.$$eval('dialog[open] button', (b) => b.some((e) => e.textContent === 'Not now')));
    await pause(200); await shot(page, `push-settings-${theme}-after`);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog[open]'));

    // 4. Notifications turned on (permission and a subscription): the icon goes, no reload, no polling.
    const asked = await page.evaluate(() => testPush.requests);
    await page.evaluate(() => { testPush.permission = 'granted'; testPush.subscribed = true; testPermission.dispatchEvent(new Event('change')); });
    await waitIcons(page, 0);
    await pause(1500);
    assert.equal(await page.evaluate(() => testPush.requests), asked + 1, 'asked the push manager once, on the change only');
    await page.close();
  }

  // 5. Already subscribed for this account: never shows.
  {
    const page = await open({ permission: 'granted', subscribed: true, owner: '00000000-0000-4000-8000-000000000001' });
    await pause(1500);
    assert.deepEqual(await visibleIcons(page), []);
    assert.equal(await page.$(icon), null);
    // Turned off from Phone notifications → the icon comes back.
    await page.evaluate(() => { testPush.subscribed = false; localStorage.removeItem('longboard.chat.push-owner.v1'); window.dispatchEvent(new Event('chat-push-changed')); });
    await waitIcons(page, 1);
    await page.close();
  }

  // 6. Permission denied: steps to re-enable in the phone's settings; "Not now" hides it for 30 days.
  for (const theme of ['light', 'dark']) {
    const page = await open({ theme, permission: 'denied' });
    await waitIcons(page, 1);
    assert.equal((await visibleIcons(page))[0].label, 'Phone notifications are blocked');
    await tapVisible(page, icon);
    await page.waitForSelector('dialog[open][data-push-prompt-sheet="denied"]');
    assert.match(await page.$eval('dialog[open]', (e) => e.textContent), /can’t ask again.*Site settings.*Allow/s);
    await pause(400); await shot(page, `denied-sheet-${theme}-after`);
    if (theme === 'dark') {
      await page.$$eval('dialog[open] button', (b) => b.find((e) => e.textContent === 'Not now').click());
      await waitIcons(page, 0);
      const until = Number(await page.evaluate(() => localStorage.getItem('longboard.chat.push-prompt-snooze.v1')));
      assert.ok(Math.abs(until - Date.now() - 30 * 86400_000) < 60_000, 'snoozed for 30 days');
      await page.reload(); await reactReady(page, composer); await pause(1500);
      assert.deepEqual(await visibleIcons(page), [], 'still hidden after a reload');
      await page.evaluate(() => localStorage.removeItem('longboard.chat.push-prompt-snooze.v1'));
    } else await page.keyboard.press('Escape');
    await page.close();
  }

  // 7. iPhone in a Safari tab: Add to Home Screen steps instead of settings.
  for (const theme of ['light', 'dark']) {
    const page = await open({ theme, iphone: true });
    await waitIcons(page, 1);
    assert.equal((await visibleIcons(page))[0].state, 'install');
    await tapVisible(page, icon);
    await page.waitForSelector('dialog[open][data-push-prompt-sheet="install"]');
    assert.match(await page.$eval('dialog[open]', (e) => e.textContent), /Home Screen.*Share.*Add to Home Screen.*16\.4/s);
    await pause(400); await shot(page, `iphone-install-sheet-${theme}-after`);
    await page.close();
  }

  // 8. "Not now" in the settings dialog opened from the icon hides it too.
  {
    const page = await open({});
    await waitIcons(page, 1);
    await tapVisible(page, icon);
    await page.waitForSelector('dialog[open] h2');
    await page.$$eval('dialog[open] button', (b) => b.find((e) => e.textContent === 'Not now').click());
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await waitIcons(page, 0);
    // Opened from the ••• menu, the dialog has no "Not now".
    await page.evaluate(() => localStorage.removeItem('longboard.chat.push-prompt-snooze.v1'));
    await page.evaluate(() => window.dispatchEvent(new Event('chat-open-push-settings')));
    await page.waitForSelector('dialog[open] h2');
    assert.equal(await page.$$eval('dialog[open] button', (b) => b.some((e) => e.textContent === 'Not now')), false);
    await page.close();
  }

  // 9. A computer never shows it, whatever the permission.
  for (const permission of ['default', 'denied']) {
    const page = await open({ permission }, '/chat?room=main', DESKTOP);
    await pause(1500);
    assert.equal(await page.$(icon), null, 'no icon on a computer: ' + permission);
    await page.close();
  }
  {
    const page = await open({ iphone: true }, '/chat?room=main', DESKTOP);
    await pause(1500);
    assert.equal(await page.$(icon), null, 'no icon on a computer-sized window');
    await page.close();
  }

  assert.deepEqual(errors, []);
  console.log('phone notify prompt checks passed');
} finally {
  await browser.close();
}
