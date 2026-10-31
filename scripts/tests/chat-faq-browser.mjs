// #332 LB-FAQ on a computer and a phone, against the shared fixture. Bob is a member, Alice an admin.
// - FAQ sits directly under What's New?, opens as a page, and has both starter topics with iPhone
//   and Android steps. Search finds items and returns nothing from rooms or messages.
// - Bob has no way to change the FAQ (no buttons, and the server refuses). Alice adds, edits and
//   deletes, and Bob sees the result.
// - The Admins room: Alice sees it; Bob has no row and every route refuses him (history, thread,
//   search, member lists, pins, polls, posting, the realtime token, the room's own address).
// - Suggest a topic: Bob's suggestion reaches the Admins room naming him, stays off the FAQ page, and
//   a second one straight away is refused.
// - #338 review: Alice has the same Suggest button; a suggestion waits with the AI's draft, or an empty
//   one when the AI fails; the review endpoint needs its own token, approves the edited text as
//   "Topic - Question", survives a double click, rejects, and the history keeps it all.
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
async function open(email, viewport = computer, composer = 'textarea[aria-label="Message LB"]') {
  const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport(viewport);
  await context.setCookie({ name: 'longboard-chat-theme', value: 'light', domain: 'localhost', path: '/' });
  await signIn(page, base, email, { composer });
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
    // #334: other rooms keep the /summary hint; the Admins room has none and refuses the command.
    await page.goto(`${base}/chat?room=social`);
    await page.waitForSelector('#longboard-chat-feedback', { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#longboard-chat-feedback').textContent.includes('/summary'), { timeout: 20000 });
    await page.click(adminsRow);
    await page.waitForSelector('textarea[aria-label="Message Admins"]', { visible: true, timeout: 60000 });
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 20000 }, `suggested an FAQ topic: ${SUGGESTION}`);
    assert((await text(page)).includes('FAQ Suggestions'));
    await shot(page, 'admin-desktop-suggestion-in-admins-room');
    const composerText = (selector) => page.$eval(selector, (e) => e.textContent);
    assert(!(await composerText('#longboard-chat-feedback')).includes('/summary'), 'no /summary hint in Admins');
    assert((await composerText('#longboard-chat-feedback')).includes('Enter to send'));
    assert(!/summar/i.test(await page.$eval('[class*="composerAbout"]', (e) => e.textContent)), 'no summaries in About privacy');
    await shot(page, 'admin-desktop-admins-no-summary-hint');
    await page.type('textarea[aria-label="Message Admins"]', '/summary');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#longboard-chat-feedback').textContent.includes('Summaries are off'), { timeout: 15000 });
    assert.equal(await page.$eval('textarea[aria-label="Message Admins"]', (e) => e.value), '/summary', 'the command is not posted');
    await page.$eval('textarea[aria-label="Message Admins"]', (e) => e.select());
    await page.keyboard.press('Backspace');
    const clientId = '00000000-0000-4000-8000-000000000334';
    assert.equal((await api(page, '/api/chat/summary', 'POST', { room: 'admins', clientId })).status, 400, 'the summary API refuses');
    assert.equal((await api(page, '/api/chat', 'POST', { room: 'admins', body: '/summary', clientId })).status, 400, 'the post API refuses');
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
  // #338: the review, the way Marketing HQ calls it: server to server, with the tokens.
  {
    const READ = 'synthetic-faq-read-token-never-a-production-secret', WRITE = 'synthetic-faq-write-token-never-a-production-secret';
    const server = async (path, token, body) => {
      const r = await fetch(`${base}/api/chat/faq/suggestions/${path}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const find = async (text) => (await server('feed', READ)).body.suggestions.find((s) => s.topic === text);
    const until = async (text, ai) => { for (let i = 0; i < 60; i++) { const row = await find(text); if (row?.ai_status === ai) return row; await sleep(500); } throw Error(`${text}: never ${ai}: ${JSON.stringify(await find(text))}`); };
    const rob = { id: 'hq-member-rob', name: 'Rob From HQ' };
    const ASK = 'What are <b>the</b> chat hours?', FAILS = 'draft-fails: please reject this one';

    // Alice sees what Bob sees, and sends one.
    const { context, page, errors } = await open('alice@example.test');
    await showList(page);
    await openFaq(page);
    const buttons = await page.$$eval('[data-faq-page] .actions button, [data-faq-page] button', (b) => b.map((x) => x.textContent.trim()));
    assert(buttons.includes('Suggest a topic') && buttons.includes('Add a question'), buttons.join(' | '));
    await shot(page, 'admin-desktop-faq-with-suggest');
    await clickText(page, 'Suggest a topic');
    await page.type('[data-faq-suggest] input', ASK);
    await shot(page, 'admin-desktop-suggest-form');
    await clickText(page, 'Send to admins');
    await page.waitForFunction(() => document.body.innerText.includes('Your suggestion went to the admins'));

    // It waits with the AI's draft, naming her, off the FAQ.
    const drafted = await until(ASK, 'ready');
    assert.equal(drafted.name, 'Alice');
    assert.equal(drafted.status, 'pending');
    assert.equal(drafted.ai_topic, 'Chat Hours');
    assert(drafted.ai_answer.includes('Drafted by the fake AI'));
    assert.deepEqual(drafted.events.map((e) => [e.action, e.actor_name]), [['submitted', 'Alice']]);
    assert.deepEqual(await questions(page), STARTERS, 'not on the FAQ before approval');

    // A failed draft: it still arrives, with nothing in the draft, and quickly.
    const mallory = await open('mallory@example.test', computer, 'textarea[aria-label^="Message"]');
    const sent = Date.now();
    assert.equal((await api(mallory.page, '/api/chat/faq/suggestions', 'POST', { question: FAILS })).status, 201);
    assert(Date.now() - sent < 5000, 'the submit does not wait for the AI');
    const failed = await until(FAILS, 'failed');
    assert.equal(failed.status, 'pending');
    assert.equal(failed.ai_topic, null);
    assert.equal(failed.ai_answer, null);
    await mallory.context.close();

    // Only the write token works, and a member's session is nothing to it.
    const approve = { id: drafted.id, action: 'approve', actor: rob, question: 'When is the <b>chat</b> open?', topic: 'Chat Hours', answer: 'Edited answer <img src=x onerror=alert(1)>' };
    assert.equal((await server('review', null, approve)).status, 401);
    assert.equal((await server('review', READ, approve)).status, 401, 'the read token cannot write');
    assert.equal((await api(page, '/api/chat/faq/suggestions/review', 'POST', approve)).status, 401, 'an admin session is not enough');
    assert.equal((await server('feed', WRITE)).status, 401, 'the write token cannot read');
    assert.equal((await server('review', WRITE, { ...approve, answer: ' ' })).status, 400, 'needs an answer');
    assert.equal((await server('review', WRITE, { ...approve, topic: '' })).status, 400, 'needs a topic');
    assert.deepEqual(await questions(page), STARTERS);

    // A double click and a second admin at the same moment: one item, one history row.
    const clicks = await Promise.all([server('review', WRITE, approve), server('review', WRITE, approve), server('review', WRITE, { ...approve, actor: { id: 'hq-member-liz', name: 'Liz From HQ' } })]);
    assert.deepEqual(clicks.map((c) => c.status), [200, 200, 200], JSON.stringify(clicks));
    assert.equal(clicks.filter((c) => c.body.outcome === 'approved').length, 1, JSON.stringify(clicks));
    const late = await server('review', WRITE, { id: drafted.id, action: 'reject', actor: rob });
    assert.equal(late.status, 409, 'too late to reject');
    assert.equal(late.body.status, 'approved');

    // On the FAQ as Topic - Question, as plain text, for a member too.
    const TITLE = 'Chat Hours - When is the <b>chat</b> open?';
    await page.reload();
    await page.waitForFunction((row) => [...document.querySelectorAll(row)].some((e) => e.checkVisibility()), { timeout: 60000 }, row);
    await openFaq(page);
    assert.deepEqual(await questions(page), [...STARTERS, TITLE], 'starters unchanged, the new one last');
    assert.equal(await page.$('[data-faq-item] b'), null, 'no raw HTML in the question');
    assert.equal(await page.$('[data-faq-item] img'), null, 'no raw HTML in the answer');
    await search(page, 'open');
    await page.waitForFunction(() => document.querySelectorAll('[data-faq-item]').length >= 1);
    await page.$$eval('[data-faq-item]', (items) => items.at(-1).scrollIntoView());
    await shot(page, 'admin-desktop-faq-approved-topic-question');
    await search(page, '');
    const member = await open('bob@example.test');
    await showList(member.page);
    await openFaq(member.page);
    assert.deepEqual(await questions(member.page), [...STARTERS, TITLE]);
    await member.context.close();

    // Reject: not on the FAQ, and out of the waiting list.
    assert.equal((await server('review', WRITE, { id: failed.id, action: 'reject', actor: rob })).status, 200);
    assert.equal((await server('review', WRITE, { id: failed.id, action: 'approve', actor: rob, question: 'Q', topic: 'T', answer: 'A' })).status, 409, 'too late to approve');
    await page.reload();
    await page.waitForFunction((row) => [...document.querySelectorAll(row)].some((e) => e.checkVisibility()), { timeout: 60000 }, row);
    await openFaq(page);
    assert(!(await text(page)).includes('draft-fails'));

    // The history keeps both.
    const history = (await server('feed', READ)).body.suggestions;
    const one = history.find((s) => s.id === drafted.id), two = history.find((s) => s.id === failed.id);
    assert.equal(one.status, 'approved');
    assert.deepEqual(one.events.map((e) => e.action), ['submitted', 'approved']);
    assert.equal(one.events[1].actor_name.endsWith('From HQ'), true);
    assert.equal(one.events[1].topic, 'Chat Hours');
    assert.equal(two.status, 'rejected');
    assert.deepEqual(two.events.map((e) => [e.action, e.actor_name]), [['submitted', 'Mallory'], ['rejected', 'Rob From HQ']]);
    for (const event of [...one.events, ...two.events]) assert(!Number.isNaN(Date.parse(event.created_at)));
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS FAQ page, search, admin editing, suggestions and the private Admins room, computer and phone.');
} finally {
  await browser.close();
}
