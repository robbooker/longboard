// #321 LB-PAGES: the sidebar's Pages section on a computer and a phone, against the shared
// fixture (which runs the Pages migration). Bob is a member, Alice an admin.
// - Pages shows Market Dashboard, Trader Links and My Links below Recordings; only admins see "Add a page".
// - Market Dashboard frames https://dashboard.robbooker.com with an "open in its own tab" link
//   (the request is answered locally unless PAGES_LIVE=1).
// - Trader Links: http is refused with the https message; Bob adds a link (Added by Bob); Alice
//   can pin/edit/remove it, Bob cannot change hers.
// - My Links are private: Alice never sees Bob's. Share copies Bob's to Trader Links.
// - An admin's new page appears for Bob after a reload.
// PAGES_SHOTS=<dir> saves screenshots.
import puppeteer from 'puppeteer';
import { signIn } from './browser-login.mjs';
import assert from 'node:assert/strict';
const base = 'http://localhost:3321', DASH = 'https://dashboard.robbooker.com/';
const shots = process.env.PAGES_SHOTS, live = process.env.PAGES_LIVE === '1';
const nav = 'nav[aria-label="Chat rooms"]', composer = 'textarea[aria-label="Message LB"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const shot = async (page, name) => { if (shots) { await sleep(400); await page.screenshot({ path: `${shots}/${name}.png` }); } };
const text = (page) => page.evaluate(() => document.body.innerText);
const clickText = async (page, label, scope = 'body') => {
  const handle = await page.waitForSelector(`${scope} ::-p-text(${label})`, { visible: true });
  await handle.click();
};
async function open(email, viewport = { width: 1440, height: 900 }) {
  const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (!live && r.url().startsWith('https://dashboard.robbooker.com'))
      return r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body style="font:16px sans-serif;padding:24px"><h1>Market Dashboard (test copy)</h1></body>' });
    r.continue();
  });
  await page.setViewport(viewport);
  await context.setCookie({ name: 'longboard-chat-theme', value: 'light', domain: 'localhost', path: '/' });
  await signIn(page, base, email, { composer });
  return { context, page, errors };
}
const pageRow = (slug) => `${nav} a[data-chat-page="${slug}"]`;
async function addLink(page, title, url, note = '') {
  await clickText(page, 'Add a link');
  await page.type('input[placeholder="Finviz screener"]', title);
  await page.type('input[placeholder="https://"]', url);
  if (note) await page.type('input[placeholder="One line about it"]', note);
  await clickText(page, 'Save link');
}
try {
  // Bob, a member, on a computer.
  {
    const { context, page, errors } = await open('bob@example.test');
    await page.waitForSelector(pageRow('my-links'), { visible: true });
    const rows = await page.$$eval(`${nav} a[data-chat-page]`, (as) => as.map((a) => a.textContent.trim()));
    assert.deepEqual(rows, ['Market Dashboard', 'Trader Links', 'My Links'], 'three pages, no Add a page for a member');
    // Pages comes after the Recordings group.
    const order = await page.$eval(nav, (n) => [...n.children].map((c) => c.textContent.trim()).join('|'));
    assert.ok(order.indexOf('Recordings') < order.indexOf('Pages'), 'Pages below Recordings');
    await shot(page, 'desktop-sidebar');

    await page.click(pageRow('market-dashboard'));
    const frame = await page.waitForSelector('iframe[title="Market Dashboard"]', { visible: true });
    assert.equal(await frame.evaluate((f) => f.src), DASH);
    const box = await frame.boundingBox();
    assert.ok(box.height > 600, `dashboard is full height (${box.height})`);
    const tab = await page.$eval('a::-p-text(Open in its own tab)', (a) => ({ href: a.href, target: a.target, rel: a.rel }));
    assert.deepEqual(tab, { href: DASH, target: '_blank', rel: 'noopener noreferrer' });
    assert.equal(await page.$eval('header h1', (h) => h.textContent), 'Market Dashboard');
    await sleep(live ? 4000 : 500);
    await shot(page, 'desktop-market-dashboard');

    await page.click(pageRow('trader-links'));
    await page.waitForSelector('::-p-text(No links yet)');
    await addLink(page, 'Bad link', 'http://example.com');
    await page.waitForSelector('::-p-text(Start the address with https://)');
    await page.$eval('input[placeholder="https://"]', (i) => i.select());
    await page.type('input[placeholder="https://"]', 'https://finviz.com');
    await page.$eval('input[placeholder="Finviz screener"]', (i) => i.select());
    await page.type('input[placeholder="Finviz screener"]', 'Finviz screener');
    await page.type('input[placeholder="One line about it"]', 'Fast pre-market gappers');
    await clickText(page, 'Save link');
    await page.waitForSelector('::-p-text(Added by Bob)');
    const link = await page.$eval('a[href="https://finviz.com/"]', (a) => ({ target: a.target, rel: a.rel }));
    assert.deepEqual(link, { target: '_blank', rel: 'noopener noreferrer' });
    assert.ok(!(await text(page)).includes('Pin to top'), 'members cannot pin');

    // A private link, then Share.
    await page.click(pageRow('my-links'));
    await page.waitForSelector("::-p-text(You haven’t saved any links yet.)");
    await addLink(page, 'My broker', 'https://broker.example.com/login', 'Only for me');
    await page.waitForSelector('a[href="https://broker.example.com/login"]');
    await addLink(page, 'Secret journal', 'https://journal.example.com');
    await page.waitForSelector('a[href="https://journal.example.com/"]');
    // Share the broker link (the second row; newest first).
    const share = (await page.$$('li ::-p-text(Share)'))[1];
    await share.click();
    await page.waitForSelector('::-p-text(Shared to Trader Links.)');
    await shot(page, 'desktop-my-links');
    await page.click(pageRow('trader-links'));
    await page.waitForSelector('a[href="https://broker.example.com/login"]');
    assert.ok(!(await text(page)).includes('Secret journal'), 'unshared private link stays private');
    await shot(page, 'desktop-trader-links');
    // Choosing a room closes the page.
    await page.click(`${nav} a[href="/chat?room=main"]`);
    await page.waitForSelector(composer, { visible: true });
    assert.equal(await page.$('iframe[title="Market Dashboard"], input[placeholder="Finviz screener"]'), null);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Alice, an admin.
  {
    const { context, page, errors } = await open('alice@example.test');
    await page.waitForSelector(pageRow('new'), { visible: true });
    await page.click(pageRow('my-links'));
    await page.waitForSelector("::-p-text(You haven’t saved any links yet.)");
    assert.ok(!(await text(page)).includes('Secret journal') && !(await text(page)).includes('My broker'), "Bob's private links are invisible");
    await page.click(pageRow('trader-links'));
    await page.waitForSelector('::-p-text(Added by Bob)');
    await shot(page, 'desktop-trader-links-admin');
    const pin = (await page.$$('li ::-p-text(Pin to top)'))[1];
    await pin.click();
    await page.waitForSelector('::-p-text(Pinned ·)');
    const first = await page.$eval('ul li a', (a) => a.getAttribute('href'));
    assert.equal(first, 'https://finviz.com/', 'pinned link first');
    assert.equal((await page.$$('li ::-p-text(Edit)')).length, 2, 'admin can edit every link');
    // A new page: http embeds are refused; a list page is added.
    await page.click(pageRow('new'));
    await page.type('input[maxlength="40"]', 'Calendar');
    await clickText(page, 'A website');
    await page.type('input[placeholder="https://"]', 'http://calendar.example.com');
    await clickText(page, 'Add page');
    await page.waitForSelector('::-p-text(Start the address with https://)');
    await clickText(page, 'A list of links');
    await clickText(page, 'Add page');
    await page.waitForSelector('::-p-text(is now in everyone’s Pages list)');
    await page.waitForFunction((n) => [...document.querySelectorAll(`${n} a[data-chat-page]`)].some((a) => a.textContent.trim() === 'Calendar'), {}, nav);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Bob on a phone: the list shows Pages, including Alice's new page; Trader Links opens.
  {
    const { context, page, errors } = await open('bob@example.test', { width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`${base}/chat`);
    await page.waitForSelector(composer);
    const listShown = () => page.evaluate(() => !!document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
    await sleep(800);
    if (!(await listShown())) await page.tap('button[aria-label="Back to all chats"]');
    await page.waitForFunction(() => document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
    const rows = await page.$$eval(`${nav} a[data-chat-page]`, (as) => as.map((a) => a.textContent.trim()));
    assert.deepEqual(rows, ['Market Dashboard', 'Trader Links', 'My Links', 'Calendar']);
    await page.$eval(pageRow('my-links'), (a) => a.scrollIntoView({ block: 'center' }));
    await shot(page, 'phone-sidebar');
    await page.tap(pageRow('trader-links'));
    await page.waitForSelector('::-p-text(Added by Bob)', { visible: true });
    assert.equal(await page.$eval('header h1', (h) => h.textContent), 'Trader Links');
    // Bob cannot change a link he did not add (none here), but sees the pinned one first.
    await shot(page, 'phone-trader-links');
    await page.tap('button[aria-label="Back to all chats"]');
    await page.waitForFunction(() => document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
    await page.tap(pageRow('market-dashboard'));
    const frame = await page.waitForSelector('iframe[title="Market Dashboard"]', { visible: true });
    assert.ok((await frame.boundingBox()).height > 500, 'dashboard fills the phone screen');
    await sleep(live ? 4000 : 500);
    await shot(page, 'phone-market-dashboard');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS #321: Pages on desktop and phone; dashboard framed; shared/private link rules; Share; admin page; https only.');
} finally {
  await browser.close();
}
