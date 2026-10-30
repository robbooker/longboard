// #332 LB-FAQ on a computer and a phone, against the shared fixture. Bob is a member, Alice an admin.
// - FAQ sits directly under What's New?, opens as a page, and has both starter topics with iPhone
//   and Android steps. Search finds items and returns nothing from rooms or messages.
// - Bob has no way to change the FAQ (no buttons, and the server refuses). Alice adds, edits and
//   deletes, and Bob sees the result.
// - The Admins room: Alice sees it; Bob has no row and every route refuses him (history, thread,
//   search, member lists, pins, polls, posting, the realtime token, the room's own address).
// - Suggest a topic: Bob's suggestion reaches the Admins room naming him, stays off the FAQ page, and
//   a second one straight away is refused.
// FAQ_SHOTS=<dir> saves screenshots.
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base = 'http://localhost:3332';
const shots = process.env.FAQ_SHOTS;
const nav = '#chat-room-navigation', row = 'a[data-chat-faq]', adminsRow = 'a[href^="/chat?room=admins"]';
const computer = { width: 1440, height: 900 }, phone = { width: 390, height: 844, isMobile: true, hasTouch: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const shot = async (page, name) => { if (shots) { await sleep(500); await page.screenshot({ path: `${shots}/${name}.png` }); } };
const text = (page) => page.evaluate(() => document.body.innerText);
const api = (page, path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, text: await r.text() };
}, { path, method, body });
const clickText = async (page, label, scope = 'body') => (await page.waitForSelector(`${scope} ::-p-text(${label})`, { visible: true })).click();
const search = async (page, value) => {
  const box = await page.waitForSelector('input[aria-label="Search the FAQ"]', { visible: true });
  await box.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value) await box.type(value);
};
const questions = (page) => page.$$eval('[data-faq-item] h2', (hs) => hs.map((h) => h.textContent));
const STARTERS = ['How do I get the chat on my phone?', 'How do I turn on phone notifications?'];
async function open(email, viewport = computer) {
  const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport(viewport);
  await context.setCookie({ name: 'longboard-chat-theme', value: 'light', domain: 'localhost', path: '/' });
  await signIn(page, base, email, { composer: 'textarea[aria-label="Message LB"]' });
  return { context, page, errors };
}
// On a phone the room list is the home screen.
async function showList(page) {
  await page.goto(`${base}/chat`);
  await page.waitForFunction((row) => [...document.querySelectorAll(row)].some((e) => e.checkVisibility()), { timeout: 60000 }, row);
}
const order = (page) => page.evaluate((nav) => {
  const list = [...document.querySelectorAll(nav)].find((e) => e.checkVisibility());
  return [...list.querySelectorAll('a')].filter((a) => a.checkVisibility() && !a.closest('section')).map((a) => a.textContent.trim());
}, nav);
// After a load the row is drawn before React has attached its click handler, and the chat's first
// room selection can still close a page opened in that moment, so a slow machine may need a second tap.
async function openFaq(page) {
  await page.waitForFunction((row) => [...document.querySelectorAll(row)].some((e) => e.checkVisibility() && Object.keys(e).some((k) => k.startsWith('__reactProps$') && typeof e[k]?.onClick === 'function')), { timeout: 60000 }, row);
  for (let attempt = 1; ; attempt++) {
    const handle = await page.evaluateHandle((row) => [...document.querySelectorAll(row)].find((e) => e.checkVisibility()), row);
    await (page.viewport()?.hasTouch ? handle.tap() : handle.click());
    try {
      await page.waitForSelector('[data-faq-page]', { visible: true, timeout: 10000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}
const SUGGESTION = 'How do margin calls work?';
try {
  // Bob, a member, on a computer.
  {
    const { context, page, errors } = await open('bob@example.test');
    // A word only a room message contains: the FAQ search must not find it.
    await page.type('textarea[aria-label="Message LB"]', 'quokka sighting in the room');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.innerText.includes('quokka sighting'), { timeout: 15000 });
    await showList(page);
    const rows = await order(page);
    const at = rows.findIndex((r) => r.startsWith("What's New"));
    assert.equal(rows[at + 1], 'FAQ', `FAQ directly under What's New?: ${rows.join(' | ')}`);
    assert(!rows.includes('Admins'), `no Admins row for a member: ${rows.join(' | ')}`);
    await shot(page, 'member-desktop-sidebar');
    await openFaq(page);
    assert.deepEqual(await questions(page), STARTERS);
    // Its own address opens it too.
    await page.goto(`${base}/chat?page=faq`);
    await page.waitForSelector('[data-faq-page]', { visible: true, timeout: 60000 });
    const page1 = await text(page);
    for (const word of ['iPhone', 'Android', 'Add to Home Screen', 'Enable notifications']) assert(page1.includes(word), word);
    assert.equal(await page.$('[data-faq-page] textarea[aria-label^="Message"]'), null, 'a page, not a chat');
    const link = await page.$eval('[data-faq-item] a', (a) => [a.getAttribute('href'), a.target, a.rel]);
    assert.deepEqual(link, ['https://www.longboardai.com/chat', '_blank', 'noopener noreferrer']);
    await shot(page, 'member-desktop-faq-page');
    // Search: the FAQ only.
    await search(page, 'notifications iphone');
    await page.waitForFunction(() => document.querySelectorAll('[data-faq-item]').length === 1);
    assert.deepEqual(await questions(page), [STARTERS[1]]);
    await shot(page, 'member-desktop-search-results');
    await search(page, 'quokka');
    await page.waitForSelector('[data-faq-count="0"]');
    assert.deepEqual(await questions(page), []);
    assert((await page.$eval('[data-faq-count]', (e) => e.textContent)).includes('Nothing in the FAQ'));
    await shot(page, 'member-desktop-search-nothing-from-rooms');
    await search(page, '');
    // No way to change anything.
    const buttons = await page.$$eval('[data-faq-page] button', (b) => b.map((x) => x.textContent.trim()));
    assert.deepEqual(buttons, ['Suggest a topic'], 'a member sees only Suggest a topic');
    const item = JSON.parse((await api(page, '/api/chat/faq')).text);
    assert.equal(item.canManage, false);
    const id = item.items[0].id, good = { question: 'Hacked?', answer: 'Yes' };
    assert.equal((await api(page, '/api/chat/faq', 'POST', good)).status, 403);
    assert.equal((await api(page, '/api/chat/faq', 'PATCH', { id, ...good })).status, 403);
    assert.equal((await api(page, `/api/chat/faq?id=${id}`, 'DELETE')).status, 403);
    // Suggest a topic.
    await shot(page, 'member-desktop-suggest-button');
    await clickText(page, 'Suggest a topic');
    await page.waitForSelector('[data-faq-suggest] input', { visible: true });
    await page.type('[data-faq-suggest] input', SUGGESTION);
    await shot(page, 'member-desktop-suggest-form');
    await clickText(page, 'Send to admins');
    await page.waitForFunction(() => document.body.innerText.includes('Your suggestion went to the admins'));
    assert(!(await page.$eval('[data-faq-page]', (e) => e.innerText)).includes(SUGGESTION), 'not on the page');
    await shot(page, 'member-desktop-suggest-sent');
    assert.equal((await api(page, '/api/chat/faq/suggestions', 'POST', { topic: 'Straight away again' })).status, 429, 'rate limited');
    assert.equal((await api(page, '/api/chat/faq/suggestions')).status, 405, 'suggestions cannot be read back');
    await page.reload();
    await page.waitForFunction((row) => [...document.querySelectorAll(row)].some((e) => e.checkVisibility()), { timeout: 60000 }, row);
    await openFaq(page);
    assert(!(await text(page)).includes(SUGGESTION), 'still not on the page');
    // The Admins room, by every route.
    const message = '00000000-0000-4000-8000-000000000000';
    const refused = [
      '/api/chat/history?room=admins', `/api/chat/thread?room=admins&id=${message}`, '/api/chat/opening?room=admins',
      '/api/chat/search?q=margin&room=admins', '/api/chat/room-members?room=admins', '/api/chat/message-pins?room=admins',
      `/api/chat/polls?room=admins&messages=${message}`, '/api/chat/summary?room=admins',
    ];
    for (const path of refused) {
      const res = await api(page, path);
      assert(res.status >= 400 && res.status < 500, `${path} refused: ${res.status}`);
      assert(!res.text.includes('margin calls'), `${path} leaks nothing: ${res.text.slice(0, 120)}`);
    }
    const sent = await api(page, '/api/chat', 'POST', { action: 'send', room: 'admins', body: 'let me in', clientId: message });
    assert(sent.status >= 400 && sent.status < 500, `posting refused: ${sent.status}`);
    for (const room of ['all', 'social', 'main', 'lb-social']) {
      const res = await api(page, `/api/chat/search?q=margin&room=${room}`);
      assert(!res.text.includes('margin calls'), `search ${room} leaks nothing`);
    }
    const token = await api(page, '/api/chat/realtime-token');
    assert(!token.text.includes('room:admins'), 'no realtime channel for the room');
    const activity = await api(page, '/api/chat/activity');
    assert(!activity.text.includes('margin calls') && !activity.text.includes('"admins"'), 'nothing in the bell');
    await page.goto(`${base}/chat?room=admins`);
    await sleep(3000);
    assert(!(await text(page)).includes('margin calls'), 'its address shows nothing');
    await shot(page, 'member-desktop-admins-address-refused');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Bob on a phone.
  {
    const { context, page, errors } = await open('bob@example.test', phone);
    await showList(page);
    const rows = await order(page);
    assert.equal(rows[rows.findIndex((r) => r.startsWith("What's New")) + 1], 'FAQ', rows.join(' | '));
    assert(!rows.includes('Admins'));
    await shot(page, 'member-phone-sidebar');
    await openFaq(page);
    assert.deepEqual(await questions(page), STARTERS);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
    await shot(page, 'member-phone-faq-page');
    await search(page, 'shortcut');
    await page.waitForFunction(() => document.querySelectorAll('[data-faq-item]').length === 1);
    await shot(page, 'member-phone-search-results');
    await search(page, '');
    await clickText(page, 'Suggest a topic');
    await page.waitForSelector('[data-faq-suggest] input', { visible: true });
    await shot(page, 'member-phone-suggest-form');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Alice, an admin, on a computer.
  {
    const { context, page, errors } = await open('alice@example.test');
    await showList(page);
    const rows = await order(page);
    assert.equal(rows[rows.findIndex((r) => r.startsWith("What's New")) + 1], 'FAQ', rows.join(' | '));
    assert(rows.includes('Admins'), rows.join(' | '));
    await shot(page, 'admin-desktop-sidebar');
    // The suggestion is in the Admins room, naming Bob.
    await page.click(adminsRow);
    await page.waitForSelector('textarea[aria-label="Message Admins"]', { visible: true, timeout: 60000 });
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 20000 }, `suggested an FAQ topic: ${SUGGESTION}`);
    assert((await text(page)).includes('FAQ Suggestions'));
    await shot(page, 'admin-desktop-suggestion-in-admins-room');
    // A regular room: admins can post, and search finds it.
    await page.type('textarea[aria-label="Message Admins"]', 'noted, thanks');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.innerText.includes('noted, thanks'), { timeout: 15000 });
    const found = await api(page, '/api/chat/search?q=margin&room=admins');
    assert.equal(found.status, 200);
    assert(found.text.includes('margin calls'), 'admins can search it');
    // Add, edit and delete.
    await openFaq(page);
    await shot(page, 'admin-desktop-faq-page');
    await clickText(page, 'Add a question');
    await page.waitForSelector('[data-faq-form] input', { visible: true });
    await page.type('[data-faq-form] input', 'What are the chat hours?');
    await page.type('[data-faq-form] textarea', 'Always open.\nSee https://www.longboardai.com/chat for more. <b>bold</b>');
    await shot(page, 'admin-desktop-add-form');
    await clickText(page, 'Save question');
    await page.waitForFunction(() => document.querySelectorAll('[data-faq-item]').length === 3);
    assert.equal(await page.$('[data-faq-item] b'), null, 'no raw HTML');
    const [added] = (await page.$$('[data-faq-item]')).slice(-1);
    await (await added.$('::-p-text(Edit)')).click();
    await page.waitForSelector('[data-faq-form] input', { visible: true });
    await shot(page, 'admin-desktop-edit-form');
    const box = await page.$('[data-faq-form] input');
    await box.click({ clickCount: 3 });
    await box.type('When is the chat open?');
    await clickText(page, 'Save changes');
    await page.waitForFunction(() => document.body.innerText.includes('When is the chat open?'));
    assert.deepEqual(errors, []);
    // Bob sees the change.
    const member = await open('bob@example.test');
    await showList(member.page);
    await openFaq(member.page);
    assert.deepEqual(await questions(member.page), [...STARTERS, 'When is the chat open?']);
    // Delete.
    page.on('dialog', (dialog) => dialog.accept());
    const [edited] = (await page.$$('[data-faq-item]')).slice(-1);
    await (await edited.$('::-p-text(Delete)')).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-faq-item]').length === 2);
    await member.page.reload();
    await member.page.waitForFunction((row) => [...document.querySelectorAll(row)].some((e) => e.checkVisibility()), { timeout: 60000 }, row);
    await openFaq(member.page);
    assert.deepEqual(await questions(member.page), STARTERS);
    await member.context.close();
    await context.close();
  }
  // Alice on a phone.
  {
    const { context, page } = await open('alice@example.test', phone);
    await showList(page);
    await shot(page, 'admin-phone-sidebar');
    await openFaq(page);
    // A direct click: the dev server's corner badge can sit over the button on a phone.
    await page.$eval('[data-faq-item] button', (b) => b.click());
    await page.waitForSelector('[data-faq-form] input', { visible: true });
    await shot(page, 'admin-phone-edit-form');
    await context.close();
    const again = await open('alice@example.test', phone);
    await again.page.goto(`${base}/chat?room=admins`);
    await again.page.waitForFunction(() => document.body.innerText.includes('suggested an FAQ topic'), { timeout: 60000 });
    await shot(again.page, 'admin-phone-suggestion-in-admins-room');
    await again.context.close();
  }
  console.log('PASS FAQ page, search, admin editing, suggestions and the private Admins room, computer and phone.');
} finally {
  await browser.close();
}
