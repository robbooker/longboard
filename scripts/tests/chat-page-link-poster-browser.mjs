// #339: a link saved from Trader Links says who posted it, on My Links too. Alice posts, Bob and
// Mallory save, on the shared fixture.
// - Both savers see "Added by Alice", in the same type as on Trader Links, on a computer and a phone.
// - It stays when the saver edits the title, and when the original is removed. It goes if the saver
//   points the copy at a different address, since the poster never posted that one.
// - A link typed into My Links has no such line. Nobody's name appears on the poster's own typed links.
// LINK_POSTER_SHOTS=<dir> saves screenshots (taken before the checks, so they also work on older code).
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base = 'http://localhost:3441';
const shots = process.env.LINK_POSTER_SHOTS;
const nav = 'nav[aria-label="Chat rooms"]', composer = 'textarea[aria-label^="Message "]';
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
const addLink = async (page, title, url, note) => {
  await (await page.waitForSelector('::-p-text(Add a link)', { visible: true })).click();
  await page.type('input[placeholder="Finviz screener"]', title);
  await page.type('input[placeholder="https://"]', url);
  if (note) await page.type('input[placeholder="One line about it"]', note);
  await (await page.waitForSelector('::-p-text(Save link)', { visible: true })).click();
  await page.waitForSelector(item(url), { visible: true });
};
const saveLink = async (page, url) => {
  await page.waitForSelector(item(url), { visible: true });
  await page.click(`${item(url)} button[data-save-link]`);
  await page.waitForSelector(`${item(url)} button[data-save-link][data-saved]`, { timeout: 10000 });
};
const text = (page, url) => page.$eval(item(url), (li) => li.innerText);
// How each line of a link is set, from the title to the Added by line, so two pages can be compared.
const look = (page, url) => page.$eval(`${item(url)} a[href]`, (a) => [...a.parentElement.children].map((el) => {
  const s = getComputedStyle(el);
  return { tag: el.tagName, text: el.innerText, font: `${s.fontSize} ${s.fontWeight} ${s.fontFamily}`, color: s.color };
}).filter((line) => line.text));
const edit = async (page, url, placeholder, value) => {
  await page.click(`${item(url)} ::-p-text(Edit)`);
  const input = await page.waitForSelector(`input[placeholder="${placeholder}"]`, { visible: true });
  await input.click({ clickCount: 3 });
  await input.type(value);
  await (await page.waitForSelector('::-p-text(Save changes)', { visible: true })).click();
};
const FIN = 'https://finviz.example.com/screener', TV = 'https://tradingview.example.com/', GONE = 'https://gone.example.com/';
const MOVED = 'https://moved.example.com/', TYPED = 'https://typed.example.com/';
try {
  const alice = await open('alice@example.test');
  const bob = await open('bob@example.test');
  const mallory = await open('mallory@example.test');
  await openPage(alice.page, 'trader-links');
  await addLink(alice.page, 'Finviz', FIN, 'Her screener');
  await addLink(alice.page, 'TradingView', TV);
  await addLink(alice.page, 'Going away', GONE);
  await openPage(bob.page, 'my-links');
  await addLink(bob.page, 'Typed in by Bob', TYPED, 'My own find');
  await openPage(bob.page, 'trader-links');
  await saveLink(bob.page, FIN);
  await saveLink(bob.page, TV);
  await saveLink(bob.page, GONE);
  const shared = await look(bob.page, FIN);
  await shot(bob.page, 'computer-trader-links');
  await openPage(bob.page, 'my-links');
  await bob.page.waitForSelector(item(FIN), { visible: true });
  await shot(bob.page, 'computer-my-links');
  const phone = await open('bob@example.test', PHONE);
  await openPage(phone.page, 'trader-links', true);
  await phone.page.waitForSelector(item(FIN), { visible: true });
  await shot(phone.page, 'phone-trader-links');
  await openPage(phone.page, 'my-links', true);
  await phone.page.waitForSelector(item(FIN), { visible: true });
  await shot(phone.page, 'phone-my-links');

  // The poster's name, not the saver's; the typed-in link has none.
  assert.match(await text(bob.page, FIN), /Added by Alice/);
  assert.ok(!/Added by/.test(await text(bob.page, TYPED)), 'a link Bob typed in stays as it was');
  // A saved link's lines match the original's, line for line.
  assert.deepEqual(await look(bob.page, FIN), shared, 'set the same way as on Trader Links');
  // The same on a phone, and nothing runs off the screen.
  assert.match(await text(phone.page, FIN), /Added by Alice/);
  assert.ok(!(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no sideways scroll');
  // Someone else saving the same link sees the same.
  await openPage(mallory.page, 'trader-links');
  await saveLink(mallory.page, FIN);
  await openPage(mallory.page, 'my-links');
  await mallory.page.waitForSelector(item(FIN), { visible: true });
  assert.match(await text(mallory.page, FIN), /Added by Alice/);

  // Editing the title keeps it; a new address drops it, because Alice never posted that one.
  await edit(bob.page, FIN, 'Finviz screener', 'Bob copy');
  await bob.page.waitForSelector(`${item(FIN)} ::-p-text(Bob copy)`);
  assert.match(await text(bob.page, FIN), /Added by Alice/);
  await edit(bob.page, TV, 'https://', MOVED);
  await bob.page.waitForSelector(item(MOVED), { visible: true });
  assert.ok(!/Added by/.test(await text(bob.page, MOVED)), 'a different address is not hers');

  // The original goes: the copy keeps its line.
  alice.page.once('dialog', (d) => d.accept());
  await alice.page.click(`${item(GONE)} ::-p-text(Remove)`);
  await alice.page.waitForFunction((sel) => !document.querySelector(sel), {}, item(GONE));
  await bob.page.reload();
  await openPage(bob.page, 'my-links');
  await bob.page.waitForSelector(item(GONE), { visible: true });
  assert.match(await text(bob.page, GONE), /Added by Alice/);

  for (const who of [alice, bob, mallory, phone]) assert.deepEqual(who.errors, []);
  console.log('PASS #339: saved links say who posted them, on a computer and a phone; typed-in links are unchanged.');
} finally {
  await browser.close();
}
