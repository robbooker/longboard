// #352 "Suggest an Improvement" in What's New, on computer and phone, against the shared synthetic fixture.
//  - A member and an admin each see the button at the top of the room.
//  - Send won't work while empty; Cancel closes the box and leaves nothing in Admins.
//  - A member's send shows the confirmation and reaches Admins with source, sender, time and exact
//    words, drawn as plain text; it is in no other room and the member still can't read Admins.
//  - A second send straight away is refused. An admin's suggestion arrives the same way.
// IMPROVE_SHOTS=<dir> saves screenshots; IMPROVE_BEFORE=1 only saves the room as it looks without the button.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { signIn } from './browser-login.mjs';
const base = 'http://localhost:3352';
const shots = process.env.IMPROVE_SHOTS, before = process.env.IMPROVE_BEFORE === '1';
const computer = { width: 1280, height: 860 }, phone = { width: 390, height: 844, isMobile: true, hasTouch: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];
const shot = async (page, name) => { if (shots) { await sleep(600); await page.screenshot({ path: `${shots}/${name}.png` }); } };
const api = (page, path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, text: await r.text() };
}, { path, method, body });
const BAR = '[data-suggest-improvement]', FORM = '[data-suggest-improvement-form]';
const visible = (page, selector) => page.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => e.checkVisibility()), { timeout: 60000 }, selector);
const LOG = (label) => `[role="log"][aria-label="${label} messages"]`;
async function open(email, viewport, composer) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(60000);
  await page.setViewport(viewport);
  await context.setCookie({ name: 'longboard-chat-theme', value: 'light', domain: 'localhost', path: '/' });
  await signIn(page, base, email, { composer });
  return { context, page };
}
// The saved choice wins over the cookie.
const setTheme = async ({ context, page }, theme) => {
  await page.evaluate((theme) => localStorage.setItem('longboard-public-chat-theme-v1', theme), theme);
  await context.setCookie({ name: 'longboard-chat-theme', value: theme, domain: 'localhost', path: '/' });
};
async function openRoom(page, room, label) {
  await page.goto(`${base}/chat?room=${room}`);
  await visible(page, LOG(label));
}
const openWhatsNew = async (page) => {
  await openRoom(page, 'whats-new', "What's New?");
  if (!before) await visible(page, BAR);
};
const clickVisible = async (page, selector) => {
  const handle = await page.evaluateHandle((s) => [...document.querySelectorAll(s)].find((e) => e.checkVisibility()), selector);
  await (page.viewport()?.hasTouch ? handle.tap() : handle.click());
};
const button = (page, scope, label) => page.evaluateHandle((scope, label) => [...document.querySelectorAll(`${scope} button`)].find((b) => b.checkVisibility() && b.textContent.trim() === label), scope, label);
const press = async (page, scope, label) => {
  const handle = await button(page, scope, label);
  assert(handle.asElement(), `${label} is there`);
  await (page.viewport()?.hasTouch ? handle.tap() : handle.click());
};
const openBox = async (page) => {
  await press(page, BAR, 'Suggest an Improvement');
  await visible(page, FORM);
};
const atTop = (page) => page.evaluate((BAR) => {
  const bar = [...document.querySelectorAll(BAR)].find((e) => e.checkVisibility());
  const log = [...document.querySelectorAll('[role="log"]')].find((e) => e.checkVisibility());
  return { button: bar?.querySelector('button')?.textContent.trim(), above: !!bar && !!log && bar.getBoundingClientRect().bottom <= log.getBoundingClientRect().top + 1, onScreen: !!bar && bar.getBoundingClientRect().top >= 0 && bar.getBoundingClientRect().right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1 };
}, BAR);
const checkTop = async (page, who) => assert.deepEqual(await atTop(page), { button: 'Suggest an Improvement', above: true, onScreen: true }, who);
const adminsText = (page) => page.$$eval('[role="log"][aria-label="Admins messages"] article, [role="log"][aria-label="Admins messages"] [data-message-id]', (rows) => rows.map((r) => r.innerText));
const sendWhen = (page, words) => page.waitForFunction((words) => [...document.querySelectorAll('[role="log"][aria-label="Admins messages"]')].some((log) => log.innerText.includes(words)), { timeout: 60000 }, words);

const WORDS = 'Add <b>bold</b> **stars** & <img src=x onerror=alert(1)> for @Alice @admins https://example.com/x https://www.tradingview.com/x/abc12345/\nand a second line';
const HEADER = (name) => `${name} suggested a chat improvement from the Suggest an Improvement button in What's New: `;
try {
  const alice = await open('alice@example.test', computer, 'textarea[aria-label="Message LB"]');
  const posted = await api(alice.page, '/api/chat', 'POST', { action: 'send', room: 'whats-new', body: 'You can now react to messages with a palm tree.', clientId: crypto.randomUUID() });
  assert.equal(posted.status < 300, true, posted.text);
  const bob = await open('bob@example.test', computer, 'textarea[aria-label="Message LB"]');
  const phoneMember = await open('mallory@example.test', phone, 'textarea[aria-label^="Message "]');

  if (before) {
    for (const theme of ['light', 'dark']) {
      await setTheme(bob, theme);
      await setTheme(phoneMember, theme);
      await openWhatsNew(bob.page);
      await shot(bob.page, `before-desktop-${theme}`);
      await openWhatsNew(phoneMember.page);
      await shot(phoneMember.page, `before-phone-${theme}`);
    }
    console.log('Before screenshots saved');
    process.exit(0);
  }

  // 1. Bob, a member, on a computer: the button, then empty and Cancel.
  await openWhatsNew(bob.page);
  await checkTop(bob.page, 'member on a computer');
  await shot(bob.page, 'after-desktop-light-button');
  await openBox(bob.page);
  const disabled = async (page) => (await button(page, FORM, 'Send')).evaluate((b) => b.disabled);
  assert.equal(await disabled(bob.page), true, 'Send is off while empty');
  await bob.page.type(`${FORM} textarea`, '   ');
  assert.equal(await disabled(bob.page), true, 'spaces count as empty');
  assert.equal((await api(bob.page, '/api/chat/improvement-suggestions', 'POST', { suggestion: '   ' })).status, 400, 'the server refuses it too');
  await bob.page.type(`${FORM} textarea`, 'NEVER SENT, cancelled');
  assert.equal(await disabled(bob.page), false, 'Send is on with words');
  await press(bob.page, FORM, 'Cancel');
  await bob.page.waitForSelector(FORM, { hidden: true });
  await openRoom(alice.page, 'admins', 'Admins');
  await sleep(1000);
  assert(!(await alice.page.evaluate(() => document.body.innerText)).includes('NEVER SENT'), 'Cancel leaves nothing in Admins');

  // 2. Too long is refused, then the real one. The extras in the body are ignored.
  assert.equal((await api(bob.page, '/api/chat/improvement-suggestions', 'POST', { suggestion: 'x'.repeat(451) })).status, 400, 'length limit');
  await openBox(bob.page);
  assert.equal(await bob.page.$eval(`${FORM} textarea`, (t) => t.value), '', 'Cancel cleared the words');
  await bob.page.$eval(`${FORM} textarea`, (t, words) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, words);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }, WORDS);
  await shot(bob.page, 'after-desktop-light-box');
  await press(bob.page, FORM, 'Send');
  await bob.page.waitForFunction(() => document.body.innerText.includes('Your suggestion went to the admins'));
  await bob.page.waitForSelector(FORM, { hidden: true });
  await shot(bob.page, 'after-desktop-light-sent');
  assert(!(await bob.page.evaluate(() => document.body.innerText)).includes('second line'), 'not in What\'s New');

  // 3. Right away again: refused. And a forged sender gets nowhere.
  assert.equal((await api(bob.page, '/api/chat/improvement-suggestions', 'POST', { suggestion: 'Again', member: 'Alice', createdAt: '2001-01-01' })).status, 429, 'rate limited');
  // Sending gave Bob nothing: no row, and the room's routes refuse him.
  assert.equal(await bob.page.$('a[href^="/chat?room=admins"]'), null, 'no Admins row for a member');
  for (const path of ['/api/chat?room=admins', '/api/chat/search?q=bold&room=admins']) assert((await api(bob.page, path)).status >= 400, `${path} refused`);
  assert.equal((await api(bob.page, '/api/chat/improvement-suggestions')).status, 405, 'suggestions cannot be read back');

  // 4. Alice sees it in Admins: source, sender, time and exact words, as plain text.
  await sendWhen(alice.page, 'second line');
  const row = await alice.page.evaluate(() => {
    const log = [...document.querySelectorAll('[role="log"][aria-label="Admins messages"]')].find((e) => e.checkVisibility());
    const body = [...log.querySelectorAll('p')].find((p) => p.textContent.includes('second line'));
    const message = body.closest('article') ?? body.parentElement.parentElement;
    return { text: body.textContent, links: body.querySelectorAll('a').length, marks: body.querySelectorAll('b, img, mark, button').length, images: message.querySelectorAll('img').length, author: message.innerText.includes('Chat Improvements'), time: !!message.querySelector('time')?.textContent.trim() };
  });
  assert.deepEqual(row, { text: HEADER('Bob') + WORDS, links: 0, marks: 0, images: 0, author: true, time: true });
  await shot(alice.page, 'after-desktop-light-admins');

  // 5. Nowhere else: not in What's New or Social for anyone.
  for (const room of ['whats-new', 'social']) {
    const history = await api(alice.page, `/api/chat?room=${room}`);
    assert(!history.text.includes('second line'), `not in ${room}`);
  }

  // 6. Alice has the button too, and hers arrives the same way, with its own name and time.
  await openWhatsNew(alice.page);
  await checkTop(alice.page, 'admin on a computer');
  await openBox(alice.page);
  await alice.page.type(`${FORM} textarea`, 'An admin idea');
  await press(alice.page, FORM, 'Send');
  await alice.page.waitForFunction(() => document.body.innerText.includes('Your suggestion went to the admins'));
  await openRoom(alice.page, 'admins', 'Admins');
  await sendWhen(alice.page, HEADER('Alice') + 'An admin idea');
  const times = await alice.page.evaluate(() => [...document.querySelectorAll('[role="log"][aria-label="Admins messages"]')].find((e) => e.checkVisibility()).querySelectorAll('time').length);
  assert(times >= 2, 'each suggestion shows its own time');

  // 7. A phone: Mallory, a member, sends from there.
  const { page: mobile } = phoneMember;
  await openWhatsNew(mobile);
  await checkTop(mobile, 'member on a phone');
  await shot(mobile, 'after-phone-light-button');
  await openBox(mobile);
  await mobile.type(`${FORM} textarea`, 'From my phone');
  await shot(mobile, 'after-phone-light-box');
  await press(mobile, FORM, 'Send');
  await mobile.waitForFunction(() => document.body.innerText.includes('Your suggestion went to the admins'));
  await shot(mobile, 'after-phone-light-sent');
  await openRoom(alice.page, 'admins', 'Admins');
  await sendWhen(alice.page, HEADER('Mallory') + 'From my phone');

  // 8. An admin on a phone sees it too, and the screenshots for dark.
  const alicePhone = await open('alice@example.test', phone, 'textarea[aria-label^="Message "]');
  await openWhatsNew(alicePhone.page);
  await checkTop(alicePhone.page, 'admin on a phone');
  await shot(alicePhone.page, 'after-phone-light-admin-button');
  if (shots) {
    await setTheme(bob, 'dark');
    await openWhatsNew(bob.page);
    await shot(bob.page, 'after-desktop-dark-button');
    await openBox(bob.page);
    await bob.page.type(`${FORM} textarea`, 'A suggestion in the dark');
    await shot(bob.page, 'after-desktop-dark-box');
    await setTheme(phoneMember, 'dark');
    await openWhatsNew(mobile);
    await shot(mobile, 'after-phone-dark-button');
    await openBox(mobile);
    await mobile.type(`${FORM} textarea`, 'A suggestion in the dark');
    await shot(mobile, 'after-phone-dark-box');
    await setTheme(alice, 'dark');
    await openRoom(alice.page, 'admins', 'Admins');
    await shot(alice.page, 'after-desktop-dark-admins');
    await setTheme(alicePhone, 'dark');
    await openRoom(alicePhone.page, 'admins', 'Admins');
    await shot(alicePhone.page, 'after-phone-dark-admins');
  }
  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS chat-improvement-suggestions');
} finally {
  await browser.close();
}
