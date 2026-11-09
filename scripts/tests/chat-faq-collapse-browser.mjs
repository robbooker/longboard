// #411 FAQ answers collapse, on a computer and a phone, against the shared fixture. Alice (an admin)
// adds a third question first, so there are three: the two starters and one with a topic.
// - Only the questions show at first: every answer is closed, each question has a +, and the one
//   button at the top says Expand all.
// - A click (or Enter / Space on the focused question) opens its answer and the + becomes −; again
//   closes it. Two can be open at once, and Expand all stays until every answer is open.
// - Expand all opens every answer and becomes Collapse all, which closes them again.
// - A search opens the answers it finds; clearing it puts back what was open.
// - /chat?page=faq#faq-<id> (and /chat#faq-<id>) opens that answer only and scrolls it into view;
//   following a question's link while the FAQ is open does the same.
// - On a phone: the same, with taps, and nothing scrolls sideways.
// FAQ_SHOTS=<dir> saves screenshots (FAQ_SHOTS_PREFIX names them, default t411-).
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base = 'http://localhost:3332';
const shots = process.env.FAQ_SHOTS, prefix = process.env.FAQ_SHOTS_PREFIX ?? 't411-';
const row = 'a[data-chat-faq]';
const computer = { width: 1440, height: 900 }, phone = { width: 390, height: 844, isMobile: true, hasTouch: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const shot = async (page, name) => { if (shots) { await sleep(500); await page.screenshot({ path: `${shots}/${prefix}${name}.png` }); } };
const api = (page, path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, text: await r.text() };
}, { path, method, body });
const ADDED = { question: 'When is the chat open?', topic: 'Chat Hours', answer: 'Always open, every day of the year.' };
async function open(email, viewport = computer, composer = 'textarea[aria-label="Message LB"]') {
  const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport(viewport);
  await context.setCookie({ name: 'longboard-chat-theme', value: 'light', domain: 'localhost', path: '/' });
  await signIn(page, base, email, { composer });
  return { context, page, errors };
}
// Each question: its text, whether its button says open, whether the answer is on screen, and the sign.
const state = (page) => page.$$eval('[data-faq-item]', (items) => items.map((item) => {
  const button = item.querySelector('[data-faq-toggle]'), answer = item.querySelector('[data-faq-answer]');
  return {
    question: item.querySelector('[data-faq-question]').textContent,
    expanded: button.getAttribute('aria-expanded'),
    controls: button.getAttribute('aria-controls') === answer.id,
    shown: answer.getBoundingClientRect().height > 0 && answer.checkVisibility(),
    sign: item.querySelector('[data-faq-sign]').textContent,
  };
}));
async function assertOpen(page, expected, why) {
  await page.waitForFunction((n) => [...document.querySelectorAll('[data-faq-toggle]')].filter((b) => b.getAttribute('aria-expanded') === 'true').length === n, { timeout: 5000 }, expected.length).catch(() => {});
  const all = await state(page);
  assert.deepEqual(all.flatMap((s, i) => (s.expanded === 'true' ? [i] : [])), expected, `${why}: ${JSON.stringify(all)}`);
  for (const [i, s] of all.entries()) {
    const isOpen = expected.includes(i);
    assert.equal(s.shown, isOpen, `${why}: answer ${i} ${isOpen ? 'shows' : 'is hidden'}`);
    assert.equal(s.sign, isOpen ? '−' : '+', `${why}: sign ${i}`);
    assert(s.controls, 'aria-controls names the answer');
  }
}
const toggleAll = (page) => page.$eval('[data-faq-toggle-all]', (b) => b.textContent.trim());
const press = async (page, index) => {
  const buttons = await page.$$('[data-faq-toggle]');
  await (page.viewport()?.hasTouch ? buttons[index].tap() : buttons[index].click());
};
async function waitForFaq(page) {
  await page.waitForSelector('[data-faq-page] [data-faq-toggle]', { visible: true, timeout: 60000 });
  // React's click handler, not just the drawn button.
  await page.waitForFunction(() => { const b = document.querySelector('[data-faq-toggle-all]'); return b && Object.keys(b).some((k) => k.startsWith('__reactProps$')); });
}
// The question's top is on screen, inside the scrolling page.
const inView = (page, id) => page.evaluate((id) => {
  const el = document.getElementById(`faq-${id}`), r = el.getBoundingClientRect();
  return r.top >= 0 && r.top < window.innerHeight - 40;
}, id);
// A fresh load: from /chat?page=faq, going to its own #faq-<id> would only change the hash.
const load = async (page, path) => { await page.goto('about:blank'); await page.goto(`${base}${path}`); };
async function search(page, value) {
  const box = await page.waitForSelector('input[aria-label="Search the FAQ"]', { visible: true });
  await box.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value) await box.type(value);
}

try {
  // Alice adds a third question, with a topic.
  let ids;
  {
    const { context, page } = await open('alice@example.test');
    const added = await api(page, '/api/chat/faq', 'POST', ADDED);
    assert.equal(added.status, 201, added.text);
    const list = JSON.parse((await api(page, '/api/chat/faq')).text).items;
    ids = list.map((item) => item.id);
    assert.equal(ids.length, 3);
    await context.close();
  }
  // Bob on a computer.
  {
    const { context, page, errors } = await open('bob@example.test');
    await page.goto(`${base}/chat?page=faq`);
    await waitForFaq(page);
    const first = await state(page);
    assert.deepEqual(first.map((s) => s.question), ['How do I get the chat on my phone?', 'How do I turn on phone notifications?', 'Chat Hours - When is the chat open?']);
    await assertOpen(page, [], 'collapsed at first');
    const visibleText = await page.$eval('[data-faq-page]', (e) => e.innerText);
    for (const word of ['Add to Home Screen', 'Always open']) assert(!visibleText.includes(word), `answer text hidden: ${word}`);
    assert.equal(await toggleAll(page), 'Expand all');
    // Accessible markup: each question is a button inside its heading.
    assert(await page.$$eval('[data-faq-item] h2 > button[data-faq-toggle]', (b) => b.length === 3));
    await shot(page, 'desktop-collapsed');

    await press(page, 0);
    await assertOpen(page, [0], 'one open');
    assert.equal(await toggleAll(page), 'Expand all');
    await shot(page, 'desktop-one-open');
    await press(page, 2);
    await assertOpen(page, [0, 2], 'two open');
    await press(page, 0);
    await assertOpen(page, [2], 'closing one leaves the other');
    await press(page, 2);
    await assertOpen(page, [], 'closed again');

    // Keyboard: Enter and Space on the focused question.
    await page.focus('[data-faq-item]:nth-child(2) [data-faq-toggle]');
    await page.keyboard.press('Enter');
    await assertOpen(page, [1], 'Enter opens');
    await page.keyboard.press('Space');
    await assertOpen(page, [], 'Space closes');

    // Expand all / Collapse all.
    await press(page, 1);
    await page.click('[data-faq-toggle-all]');
    await assertOpen(page, [0, 1, 2], 'Expand all');
    assert.equal(await toggleAll(page), 'Collapse all');
    await shot(page, 'desktop-expanded-all');
    await press(page, 1);
    assert.equal(await toggleAll(page), 'Expand all', 'one closed: Expand all again');
    await press(page, 1);
    assert.equal(await toggleAll(page), 'Collapse all', 'all open by hand: Collapse all');
    await page.click('[data-faq-toggle-all]');
    await assertOpen(page, [], 'Collapse all');
    assert.equal(await toggleAll(page), 'Expand all');

    // A search opens what it finds; clearing it puts back what was open.
    await press(page, 0);
    await search(page, 'always open');
    await page.waitForFunction(() => document.querySelectorAll('[data-faq-item]').length === 1);
    await assertOpen(page, [0], 'the match is open');
    assert((await page.$eval('[data-faq-page]', (e) => e.innerText)).includes('Always open'));
    assert.equal(await toggleAll(page), 'Collapse all');
    await shot(page, 'desktop-search-opens');
    await search(page, '');
    await page.waitForFunction(() => document.querySelectorAll('[data-faq-item]').length === 3);
    await assertOpen(page, [0], 'back as before the search');

    // A link to one question opens it, and only it, and scrolls to it.
    await load(page, `/chat?page=faq#faq-${ids[2]}`);
    await waitForFaq(page);
    await assertOpen(page, [2], 'the linked question');
    assert(await inView(page, ids[2]), 'scrolled to it');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-faq-item]')?.id), `faq-${ids[2]}`, 'focus on the linked question');
    await shot(page, 'desktop-deep-link');
    // Without ?page=faq.
    await load(page, `/chat#faq-${ids[1]}`);
    await waitForFaq(page);
    await assertOpen(page, [1], 'the linked question, no ?page');
    // Following a question's link while the FAQ is open.
    await page.evaluate((id) => { window.location.hash = `faq-${id}`; }, ids[0]);
    await assertOpen(page, [0, 1], 'the followed link opens too');
    // A link to a question that is gone opens nothing.
    await load(page, `/chat?page=faq#faq-00000000-0000-4000-8000-000000000411`);
    await waitForFaq(page);
    await assertOpen(page, [], 'unknown question');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Bob on a phone.
  {
    const { context, page, errors } = await open('bob@example.test', phone, 'textarea[aria-label^="Message"]');
    await page.goto(`${base}/chat?page=faq`);
    await waitForFaq(page);
    await assertOpen(page, [], 'phone: collapsed at first');
    assert.equal(await toggleAll(page), 'Expand all');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
    await shot(page, 'phone-collapsed');
    await press(page, 0);
    await assertOpen(page, [0], 'phone: one open');
    await shot(page, 'phone-one-open');
    await press(page, 1);
    await assertOpen(page, [0, 1], 'phone: two open');
    await press(page, 0);
    await assertOpen(page, [1], 'phone: tap again closes');
    await page.$eval('[data-faq-toggle-all]', (b) => b.scrollIntoView());
    await (await page.$('[data-faq-toggle-all]')).tap();
    await assertOpen(page, [0, 1, 2], 'phone: Expand all');
    assert.equal(await toggleAll(page), 'Collapse all');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll, all open');
    await page.$eval('[data-faq-page]', (e) => e.scrollTo(0, 0));
    await shot(page, 'phone-expanded-all');
    await (await page.$('[data-faq-toggle-all]')).tap();
    await assertOpen(page, [], 'phone: Collapse all');
    // A link on a phone.
    await load(page, `/chat?page=faq#faq-${ids[2]}`);
    await waitForFaq(page);
    await assertOpen(page, [2], 'phone: the linked question');
    assert(await inView(page, ids[2]), 'phone: scrolled to it');
    await shot(page, 'phone-deep-link');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS FAQ answers start closed, open and close one at a time or all at once, open from search and from a link, computer and phone.');
} finally {
  await browser.close();
}
