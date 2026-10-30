// #336, before its migration is applied: the fixture leaves it out. Trader Links and My Links still
// load and work, likes included, with no Save button and no reactions; the chat still posts and
// its message reactions still work. The new routes answer plainly and change nothing.
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base = 'http://localhost:3337';
const nav = 'nav[aria-label="Chat rooms"]', composer = 'textarea[aria-label="Message LB"]';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const open = async (email) => {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await signIn(page, base, email, { composer });
  return { page, errors };
};
const openPage = async (page, slug) => {
  const row = `${nav} a[data-chat-page="${slug}"]`;
  await page.waitForSelector(row, { visible: true });
  await page.click(row);
  await page.waitForFunction(() => !/Loading links/.test(document.body.innerText));
};
const addLink = async (page, title, url) => {
  await (await page.waitForSelector('::-p-text(Add a link)', { visible: true })).click();
  await page.type('input[placeholder="Finviz screener"]', title);
  await page.type('input[placeholder="https://"]', url);
  await (await page.waitForSelector('::-p-text(Save link)', { visible: true })).click();
  await page.waitForSelector(`li:has(a[href="${url}"])`, { visible: true });
};
const URL_A = 'https://a.example.com/', URL_B = 'https://b.example.com/';
try {
  const alice = await open('alice@example.test'), bob = await open('bob@example.test');
  // The chat itself: posting, and a reaction on a message.
  await alice.page.type(composer, 'Message before the migration');
  await alice.page.keyboard.press('Enter');
  await bob.page.waitForFunction(() => /Message before the migration/.test(document.body.innerText), { timeout: 20000 });
  const message = await bob.page.waitForSelector('article:has(*) button[aria-label="Add reaction"]');
  await bob.page.evaluate((b) => b.click(), message);
  await bob.page.waitForSelector('dialog button[aria-label="heart reaction"]');
  await bob.page.evaluate(() => document.querySelector('dialog button[aria-label="heart reaction"]').click());
  await bob.page.waitForSelector('button[aria-label*=" heart reaction, 1"]', { timeout: 15000 });

  // Trader Links: list, add, like. No Save, no reactions.
  await openPage(alice.page, 'trader-links');
  await addLink(alice.page, 'A link', URL_A);
  await openPage(bob.page, 'trader-links');
  const row = `li:has(a[href="${URL_A}"])`;
  await bob.page.waitForSelector(row, { visible: true });
  await bob.page.click(`${row} button[data-like]`);
  await bob.page.waitForFunction((s) => document.querySelector(s)?.textContent.trim() === '1' && !document.querySelector(s).hasAttribute('aria-busy'), { timeout: 10000 }, `${row} button[data-like]`);
  assert.equal(await bob.page.$('button[data-save-link]'), null, 'no Save button');
  assert.equal(await bob.page.$(`${row} button[aria-label="Add reaction"]`), null, 'no reaction button');

  // The new routes answer plainly.
  const statuses = await bob.page.evaluate(async () => {
    const list = await (await fetch('/api/chat/pages')).json();
    const page = list.pages.find((p) => p.slug === 'trader-links').id;
    const links = await (await fetch(`/api/chat/pages/links?page=${page}`)).json();
    const id = links.links[0].id;
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
    return {
      saved: links.saved, reactions: links.reactions, likes: links.likes,
      save: await post('/api/chat/pages/links/save', { id }),
      read: await post('/api/chat/pages/links/reactions', { kind: 'link', action: 'read', messageIds: [id] }),
      set: await post('/api/chat/pages/links/reactions', { kind: 'link', action: 'set', messageId: id, emoji: 'heart', active: true }),
    };
  });
  assert.deepEqual(statuses, { saved: null, reactions: null, likes: true, save: 503, read: 503, set: 503 });

  // My Links: add, edit-free read, share.
  await openPage(bob.page, 'my-links');
  await addLink(bob.page, 'Mine', URL_B);
  await (await bob.page.waitForSelector(`li:has(a[href="${URL_B}"]) ::-p-text(Share)`, { visible: true })).click();
  await bob.page.waitForFunction(() => /Shared to Trader Links/.test(document.body.innerText), { timeout: 10000 });
  await openPage(bob.page, 'trader-links');
  await bob.page.waitForSelector(`li:has(a[href="${URL_B}"])`, { visible: true });
  assert.deepEqual(alice.errors, []);
  assert.deepEqual(bob.errors, []);
  // LINK_SAVES_SHOTS=<dir>: what members see until the migration runs, the same as before #336.
  if (process.env.LINK_SAVES_SHOTS) {
    const dir = process.env.LINK_SAVES_SHOTS;
    await bob.page.screenshot({ path: `${dir}/before-computer-trader-links.png` });
    await bob.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await bob.page.reload();
    await bob.page.waitForSelector('button[aria-label="Back to all chats"]', { visible: true, timeout: 30000 }).catch(() => {});
    const row = `${nav} a[data-chat-page="trader-links"]`;
    if (!(await bob.page.$eval(row, (a) => a.checkVisibility()).catch(() => false))) await bob.page.tap('button[aria-label="Back to all chats"]');
    await bob.page.waitForSelector(row, { visible: true });
    await bob.page.$eval(row, (a) => a.scrollIntoView({ block: 'center' }));
    await bob.page.tap(row);
    await bob.page.waitForSelector(`li:has(a[href="${URL_A}"])`, { visible: true });
    await new Promise((r) => setTimeout(r, 400));
    await bob.page.screenshot({ path: `${dir}/before-phone-trader-links.png` });
  }
  console.log('PASS #336 before its migration: chat, message reactions, Trader Links, likes, My Links and Share all work; Save and reactions stay hidden.');
} finally {
  await browser.close();
}
