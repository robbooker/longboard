// #336: Save and reactions on the links on Trader Links, against the shared fixture. Bob and Alice
// are members (Alice an admin); both windows stay open, so each sees the other's changes.
// - Save: every link has a button on a computer and a phone. Saving puts a copy on your own My
//   Links only, the button shows Saved, and neither a reload nor a repeat request adds a second one.
// - The copy: editing or removing the original doesn't touch it; editing it doesn't change the
//   original; removing it leaves the original and the button offers Save again.
// - Reactions: the chat's four choices, add and take back, several at once, and the other person's
//   open page shows the reaction and count without a reload. My Links have neither control.
// LINK_SAVES_SHOTS=<dir> saves screenshots.
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base = 'http://localhost:3336';
const shots = process.env.LINK_SAVES_SHOTS;
const nav = 'nav[aria-label="Chat rooms"]', composer = 'textarea[aria-label="Message LB"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const shot = async (page, name) => { if (shots) { await sleep(400); await page.screenshot({ path: `${shots}/${name}.png` }); } };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
async function open(email, viewport = { width: 1440, height: 900 }) {
  const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport(viewport);
  await context.setCookie({ name: 'longboard-chat-theme', value: 'light', domain: 'localhost', path: '/' });
  await signIn(page, base, email, { composer });
  return { context, page, errors };
}
const openPage = async (page, slug, phone = false) => {
  const row = `${nav} a[data-chat-page="${slug}"]`;
  // A phone lands on the list or in a room, and settles a moment after the chat appears (as in
  // chat-pages: judge after the pause, then wait for the list to take over).
  if (phone) {
    const listShown = () => page.evaluate(() => !!document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
    await sleep(800);
    if (!(await listShown())) await page.tap('button[aria-label="Back to all chats"]');
    await page.waitForFunction(() => document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
  }
  await page.waitForSelector(row, { visible: true });
  await page.$eval(row, (a) => a.scrollIntoView({ block: 'center' }));
  if (phone) await page.tap(row);
  else await page.click(row);
  await page.waitForFunction(() => !/Loading links/.test(document.body.innerText));
};
const item = (url) => `li:has(a[href="${url}"])`;
const saveButton = (url) => `${item(url)} button[data-save-link]`;
const waitSaved = (page, url) => page.waitForSelector(`${saveButton(url)}[data-saved]`, { timeout: 10000 });
const waitUnsaved = (page, url) => page.waitForSelector(`${saveButton(url)}:not([data-saved]):not([disabled])`, { timeout: 10000 });
const addLink = async (page, title, url, note) => {
  await (await page.waitForSelector('::-p-text(Add a link)', { visible: true })).click();
  await page.type('input[placeholder="Finviz screener"]', title);
  await page.type('input[placeholder="https://"]', url);
  if (note) await page.type('input[placeholder="One line about it"]', note);
  await (await page.waitForSelector('::-p-text(Save link)', { visible: true })).click();
  await page.waitForSelector(item(url), { visible: true });
};
const listed = (page) => page.$$eval('ul li a[href^="https://"]', (as) => as.map((a) => a.getAttribute('href')));
const chip = (url, name) => `${item(url)} button[aria-label*=" ${name} reaction, "]`;
const chipText = (page, url, name) => page.$eval(chip(url, name), (b) => b.textContent.trim()).catch(() => null);
const waitChip = (page, url, name, count) => page.waitForFunction(
  (sel, want) => { const b = document.querySelector(sel); return want === null ? !b : b?.textContent.trim().endsWith(String(want)); },
  { timeout: 15000 }, chip(url, name), count);
const react = async (page, url, name) => {
  await page.click(`${item(url)} button[aria-label="Add reaction"]`);
  await page.waitForSelector(`${item(url)} dialog button[aria-label="${name} reaction"]`, { visible: true });
  await page.click(`${item(url)} dialog button[aria-label="${name} reaction"]`);
};
const FIN = 'https://finviz.example.com/screener', TV = 'https://tradingview.example.com/', GONE = 'https://gone.example.com/';
try {
  const alice = await open('alice@example.test');
  const bob = await open('bob@example.test');
  await openPage(alice.page, 'trader-links');
  await addLink(alice.page, 'Finviz', FIN, 'Her screener');
  await addLink(alice.page, 'TradingView', TV);
  await addLink(alice.page, 'Going away', GONE);
  await openPage(bob.page, 'trader-links');
  await bob.page.waitForSelector(item(GONE), { visible: true });
  await shot(bob.page, 'computer-before-save');

  // Every link has a Save button, also the viewer's own.
  for (const url of [FIN, TV, GONE]) {
    assert.equal(await bob.page.$eval(saveButton(url), (b) => b.textContent.trim()), 'Save');
    assert.equal(await alice.page.$eval(saveButton(url), (b) => b.textContent.trim()), 'Save');
  }

  // Save: the button shows it, and it stays after a reload.
  await bob.page.click(saveButton(FIN));
  await waitSaved(bob.page, FIN);
  assert.match(await bob.page.$eval(saveButton(FIN), (b) => b.textContent), /Saved/);
  assert.equal(await bob.page.$eval(saveButton(FIN), (b) => b.disabled), true, "you can't press it again");
  await bob.page.click(saveButton(GONE));
  await waitSaved(bob.page, GONE);
  await shot(bob.page, 'computer-after-save');
  await openPage(bob.page, 'my-links');
  await bob.page.waitForSelector(item(FIN), { visible: true });
  assert.deepEqual((await listed(bob.page)).sort(), [FIN, GONE].sort(), 'both copies are on My Links');
  assert.match(await bob.page.$eval(item(FIN), (li) => li.innerText), /Her screener/, 'the note came too');
  assert.equal(await bob.page.$('button[data-save-link]'), null, 'My Links have no Save');
  assert.equal(await bob.page.$('li:has(a[href^="https://"]) button[aria-label="Add reaction"]'), null, 'My Links have no reactions');
  await shot(bob.page, 'computer-my-links');

  // Another person's My Links don't change, and theirs aren't shown as saved.
  await openPage(alice.page, 'my-links');
  await alice.page.waitForFunction(() => /You haven’t saved any links yet/.test(document.body.innerText));
  await openPage(alice.page, 'trader-links');
  await waitUnsaved(alice.page, FIN);

  // Not a second time, even asked for directly.
  await openPage(bob.page, 'trader-links');
  await waitSaved(bob.page, FIN);
  const again = await bob.page.evaluate(async () => {
    const list = await (await fetch('/api/chat/pages')).json();
    const id = list.pages.find((p) => p.slug === 'trader-links').id;
    const links = await (await fetch(`/api/chat/pages/links?page=${id}`)).json();
    const target = links.links.find((l) => l.url.startsWith('https://finviz'));
    const replies = await Promise.all([1, 2, 3].map(() => fetch('/api/chat/pages/links/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: target.id }) }).then((r) => r.status)));
    const mine = await (await fetch('/api/chat/pages/my-links')).json();
    return { replies, copies: mine.links.filter((l) => l.url.startsWith('https://finviz')).length };
  });
  assert.deepEqual(again, { replies: [200, 200, 200], copies: 1 }, 'repeat requests add nothing');

  // The original is edited, then removed: the copies don't change.
  await openPage(alice.page, 'trader-links');
  await alice.page.waitForSelector(item(FIN), { visible: true });
  await alice.page.click(`${item(FIN)} ::-p-text(Edit)`);
  const title = await alice.page.waitForSelector('input[placeholder="Finviz screener"]', { visible: true });
  await title.click({ clickCount: 3 });
  await title.type('Renamed by Alice');
  await (await alice.page.waitForSelector('::-p-text(Save changes)', { visible: true })).click();
  await alice.page.waitForSelector(`${item(FIN)} ::-p-text(Renamed by Alice)`);
  alice.page.once('dialog', (d) => d.accept());
  await alice.page.click(`${item(GONE)} ::-p-text(Remove)`);
  await alice.page.waitForFunction((sel) => !document.querySelector(sel), {}, item(GONE));
  await openPage(bob.page, 'my-links');
  await bob.page.waitForSelector(item(GONE), { visible: true });
  assert.ok(!(await bob.page.$eval(item(FIN), (li) => li.innerText)).includes('Renamed by Alice'), "an edit doesn't reach the copy");

  // Bob edits his copy: Trader Links keep the original, and the button still says Saved.
  await bob.page.click(`${item(FIN)} ::-p-text(Edit)`);
  const mine = await bob.page.waitForSelector('input[placeholder="Finviz screener"]', { visible: true });
  await mine.click({ clickCount: 3 });
  await mine.type('Bob copy');
  await (await bob.page.waitForSelector('::-p-text(Save changes)', { visible: true })).click();
  await bob.page.waitForSelector(`${item(FIN)} ::-p-text(Bob copy)`);
  await openPage(bob.page, 'trader-links');
  await waitSaved(bob.page, FIN);
  assert.match(await bob.page.$eval(item(FIN), (li) => li.innerText), /Renamed by Alice/);

  // Bob removes his copy: the original stays, and it can be saved again.
  await openPage(bob.page, 'my-links');
  bob.page.once('dialog', (d) => d.accept());
  await bob.page.waitForSelector(item(FIN), { visible: true });
  await bob.page.click(`${item(FIN)} ::-p-text(Remove)`);
  await bob.page.waitForFunction((sel) => !document.querySelector(sel), {}, item(FIN));
  assert.deepEqual(await listed(bob.page), [GONE], 'the copy of the removed original is still there');
  await openPage(bob.page, 'trader-links');
  await waitUnsaved(bob.page, FIN);
  assert.deepEqual((await listed(bob.page)).sort(), [FIN, TV].sort(), 'the original is still on Trader Links');

  // A web address already on My Links counts as saved.
  await openPage(bob.page, 'my-links');
  await addLink(bob.page, 'Typed in', TV);
  await openPage(bob.page, 'trader-links');
  await waitSaved(bob.page, TV);

  // Reactions: the four choices, on Bob's computer, seen by Alice without a reload.
  await bob.page.waitForSelector(`${item(FIN)} button[aria-label="Add reaction"]`, { visible: true });
  await shot(bob.page, 'computer-before-reaction');
  await bob.page.click(`${item(FIN)} button[aria-label="Add reaction"]`);
  await bob.page.waitForSelector(`${item(FIN)} dialog`, { visible: true });
  assert.deepEqual(await bob.page.$$eval(`${item(FIN)} dialog button[aria-label$=" reaction"]`, (bs) => bs.map((b) => b.getAttribute('aria-label'))),
    ['like reaction', 'heart reaction', 'laugh reaction', 'rob reaction']);
  await shot(bob.page, 'computer-reaction-picker');
  await bob.page.click(`${item(FIN)} dialog button[aria-label="heart reaction"]`);
  await waitChip(bob.page, FIN, 'heart', 1);
  await react(bob.page, FIN, 'rob');
  await waitChip(bob.page, FIN, 'rob', 1);
  await waitChip(alice.page, FIN, 'heart', 1);
  await waitChip(alice.page, FIN, 'rob', 1);
  assert.equal(await alice.page.$eval(chip(FIN, 'heart'), (b) => b.getAttribute('aria-pressed')), 'false', 'not hers');
  // Alice adds to it, on her own link: Bob's open page updates its count.
  await alice.page.click(chip(FIN, 'heart'));
  await waitChip(alice.page, FIN, 'heart', 2);
  await waitChip(bob.page, FIN, 'heart', 2);
  await shot(bob.page, 'computer-after-reaction');
  // Holding a chip lists who reacted, as in the chat.
  await bob.page.click(chip(FIN, 'heart'), { button: 'right' });
  await bob.page.waitForFunction(() => { const d = document.querySelector('dialog[open]'); return d && /Alice/.test(d.innerText) && /Bob/.test(d.innerText); }, { timeout: 10000 });
  await bob.page.keyboard.press('Escape');
  await bob.page.waitForFunction(() => !document.querySelector('dialog[open]'));
  // Taking it back, on the chip: the count falls for both, and the chip goes at zero.
  await bob.page.click(chip(FIN, 'heart'));
  await waitChip(bob.page, FIN, 'heart', 1);
  await waitChip(alice.page, FIN, 'heart', 1);
  await bob.page.click(chip(FIN, 'rob'));
  await waitChip(bob.page, FIN, 'rob', null);
  await waitChip(alice.page, FIN, 'rob', null);
  // Reactions survive a reload, and likes still work beside them.
  await bob.page.reload();
  await bob.page.waitForSelector(composer, { visible: true }).catch(() => {});
  await openPage(bob.page, 'trader-links');
  await waitChip(bob.page, FIN, 'heart', 1);
  await bob.page.click(`${item(FIN)} button[data-like]`);
  await bob.page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-pressed') === 'true' && !document.querySelector(sel).hasAttribute('aria-busy'), {}, `${item(FIN)} button[data-like]`);
  assert.deepEqual(alice.errors, []);
  assert.deepEqual(bob.errors, []);
  await bob.context.close();

  // Bob on a phone: the same, by touch.
  const bobPhone = await open('bob@example.test', PHONE);
  await openPage(bobPhone.page, 'trader-links', true);
  await bobPhone.page.waitForSelector(item(TV), { visible: true });
  await shot(bobPhone.page, 'phone-before-save');
  const box = await (await bobPhone.page.$(saveButton(TV))).boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'the Save button is on screen on a phone');
  assert.ok(!(await bobPhone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no sideways scroll');
  await bobPhone.page.tap(saveButton(TV));
  await waitSaved(bobPhone.page, TV);
  await bobPhone.page.tap(`${item(TV)} button[aria-label="Add reaction"]`);
  await bobPhone.page.waitForSelector(`${item(TV)} dialog button[aria-label="laugh reaction"]`, { visible: true });
  await shot(bobPhone.page, 'phone-reaction-picker');
  await bobPhone.page.tap(`${item(TV)} dialog button[aria-label="laugh reaction"]`);
  await waitChip(bobPhone.page, TV, 'laugh', 1);
  await shot(bobPhone.page, 'phone-after');
  await bobPhone.page.tap(chip(TV, 'laugh'));
  await waitChip(bobPhone.page, TV, 'laugh', null);
  await bobPhone.page.tap(`${item(TV)} button[aria-label="Add reaction"]`);
  await bobPhone.page.waitForSelector(`${item(TV)} dialog button[aria-label="laugh reaction"]`, { visible: true });
  await bobPhone.page.tap(`${item(TV)} dialog button[aria-label="laugh reaction"]`);
  await waitChip(bobPhone.page, TV, 'laugh', 1);
  await waitChip(alice.page, TV, 'laugh', 1);
  assert.deepEqual(bobPhone.errors, []);
  await bobPhone.context.close();
  await alice.context.close();
  console.log('PASS #336: Save and reactions on Trader Links, on a computer and a phone; copies are private and independent of the original.');
} finally {
  await browser.close();
}
