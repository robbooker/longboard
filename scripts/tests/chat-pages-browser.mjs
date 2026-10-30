// #321 LB-PAGES: the sidebar's Pages section on a computer and a phone, against the shared
// fixture (which runs the Pages migration). Bob is a member, Alice an admin.
// - Pages shows Market Dashboard, Trader Links and My Links below Recordings; only admins see "Add a page".
// - Market Dashboard frames https://dashboard.robbooker.com with an "open in its own tab" link
//   (the request is answered locally unless PAGES_LIVE=1).
// - Trader Links: http is refused with the https message; Bob adds a link (Added by Bob); Alice
//   can pin/edit/remove it, Bob cannot change hers.
// - My Links are private: Alice never sees Bob's. Share copies Bob's to Trader Links.
// - An admin's new page appears for Bob after a reload.
// - #323 likes: each Trader Links link has a like button and count. Liking moves a link above
//   one it passes, tapping again takes the like back, your own links show their count with the
//   button off (and the server refuses), the pinned link stays on top with no likes, and the
//   Top / New switch reorders the list. Checked as Alice on a computer and Bob on a phone.
// - #329 suggestions: a member suggests a page from the same form, on a computer and a phone. It
//   is hidden from others (sidebar, deep link, API) and marked Waiting for the member. An admin sees
//   the count and the list; Approve puts it in everyone's sidebar, Decline never does and the member
//   sees Declined and can dismiss it. Members can't approve; a fourth waiting page is refused; Trader Links
//   link adding is untouched (above). Admins' own pages still need no approval (above).
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
  // Mallory has Social only, so she lands there rather than in LB.
  await signIn(page, base, email, { composer: email.startsWith('mallory') ? 'textarea[aria-label="Message Social"]' : composer });
  return { context, page, errors };
}
const pageRow = (slug) => `${nav} a[data-chat-page="${slug}"]`;
// #323: the shared list's links top to bottom, as [address, like count, liked, button on].
const linkRows = (page) =>
  page.$$eval('ul li', (lis) =>
    lis.filter((li) => li.querySelector('button[data-like]')).map((li) => {
      const like = li.querySelector('button[data-like]');
      return [li.querySelector('a').getAttribute('href'), Number(like.textContent.trim()), like.getAttribute('aria-pressed') === 'true', !like.disabled];
    }),
  );
const likeButton = (url) => `li:has(> div > a[href="${url}"]) button[data-like]`;
const waitForOrder = async (page, urls) => {
  // Optimistic first; then wait until the server has answered (the button stops being busy).
  await page.waitForFunction(() => !document.querySelector('button[data-like][aria-busy="true"]'), { timeout: 10000 });
  await page.waitForFunction(
    (want) => JSON.stringify([...document.querySelectorAll('ul li')].map((li) => li.querySelector('a')?.getAttribute('href'))) === JSON.stringify(want),
    { timeout: 5000 },
    urls,
  ).catch(async () => assert.deepEqual((await linkRows(page)).map((row) => row[0]), urls));
};
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
    assert.deepEqual(rows, ['Market Dashboard', 'Trader Links', 'My Links', 'Suggest a page'], 'three pages; a member gets Suggest a page, not Add a page');
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

    // #323 likes, as Alice: she adds a link of her own, then likes Bob's broker link.
    const FINVIZ = 'https://finviz.com/', BROKER = 'https://broker.example.com/login', CAL = 'https://calendar.example.org/';
    await addLink(page, 'Earnings calendar', CAL, 'Who reports this week');
    await page.waitForSelector(likeButton(CAL));
    assert.deepEqual(await linkRows(page), [[FINVIZ, 0, false, true], [CAL, 0, false, false], [BROKER, 0, false, true]],
      'pinned first, then newest first while nothing has likes; her own link has its button off');
    assert.equal(await page.$eval('[role="group"][aria-label="Order links by"] button[aria-pressed="true"]', (b) => b.textContent), 'Top', 'Top is the default');
    await page.click(likeButton(BROKER));
    assert.equal(await page.$eval('ul li a', (a) => a.getAttribute('href')), FINVIZ);
    assert.deepEqual((await linkRows(page))[1], [BROKER, 1, true, true], 'the like shows at once, before the server answers');
    await waitForOrder(page, [FINVIZ, BROKER, CAL]);
    assert.deepEqual(await linkRows(page), [[FINVIZ, 0, false, true], [BROKER, 1, true, true], [CAL, 0, false, false]], 'a like moves it up; pinned stays on top with 0');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed')), 'true', 'focus stays on the like button after it moves');
    await page.click(likeButton(BROKER));
    await waitForOrder(page, [FINVIZ, CAL, BROKER]);
    assert.deepEqual((await linkRows(page))[2], [BROKER, 0, false, true], 'tapping again takes the like back');
    // Quick taps while a request is out are not lost: like, unlike, like ends liked once.
    for (let i = 0; i < 3; i++) await page.click(likeButton(BROKER));
    await waitForOrder(page, [FINVIZ, BROKER, CAL]);
    assert.deepEqual((await linkRows(page))[1], [BROKER, 1, true, true]);
    // The server agrees after a reload, and refuses a like on her own link.
    await page.click(pageRow('my-links'));
    await page.waitForSelector("::-p-text(You haven’t saved any links yet.)");
    assert.equal(await page.$('button[data-like]'), null, 'My Links have no likes');
    await page.click(pageRow('trader-links'));
    await page.waitForSelector(likeButton(BROKER));
    assert.deepEqual(await linkRows(page), [[FINVIZ, 0, false, true], [BROKER, 1, true, true], [CAL, 0, false, false]]);
    const ownId = await page.$eval(likeButton(CAL), (b) => b.dataset.like);
    const refused = await page.evaluate(async (id) => {
      const r = await fetch('/api/chat/pages/links/likes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      return [r.status, (await r.json()).error];
    }, ownId);
    assert.deepEqual(refused, [403, "You can't like your own link."]);
    await shot(page, 'desktop-trader-links-likes-top');
    await clickText(page, 'New', '[role="group"]');
    await waitForOrder(page, [FINVIZ, CAL, BROKER]);
    await shot(page, 'desktop-trader-links-likes-new');
    await clickText(page, 'Top', '[role="group"]');
    await waitForOrder(page, [FINVIZ, BROKER, CAL]);
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
    assert.deepEqual(rows, ['Market Dashboard', 'Trader Links', 'My Links', 'Calendar', 'Suggest a page']);
    await page.$eval(pageRow('my-links'), (a) => a.scrollIntoView({ block: 'center' }));
    await shot(page, 'phone-sidebar');
    await page.tap(pageRow('trader-links'));
    await page.waitForSelector('::-p-text(Added by Bob)', { visible: true });
    assert.equal(await page.$eval('header h1', (h) => h.textContent), 'Trader Links');
    // Bob cannot change a link he did not add (none here), but sees the pinned one first.
    await shot(page, 'phone-trader-links');
    // #323 likes on a phone: his own two links show their counts with the button off; he likes
    // Alice's calendar, which ties the broker link at 1 and, being newer, moves above it.
    {
      const FINVIZ = 'https://finviz.com/', BROKER = 'https://broker.example.com/login', CAL = 'https://calendar.example.org/';
      await page.waitForSelector(likeButton(CAL), { visible: true });
      assert.deepEqual(await linkRows(page), [[FINVIZ, 0, false, false], [BROKER, 1, false, false], [CAL, 0, false, true]]);
      await page.tap(likeButton(CAL));
      await waitForOrder(page, [FINVIZ, CAL, BROKER]);
      assert.deepEqual(await linkRows(page), [[FINVIZ, 0, false, false], [CAL, 1, true, true], [BROKER, 1, false, false]]);
      const box = await page.$eval(likeButton(CAL), (b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
      assert.ok(box[0] >= 44 && box[1] >= 44, `like button is a comfortable tap target (${box})`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
      await shot(page, 'phone-trader-links-likes-top');
      await page.tap('[role="group"][aria-label="Order links by"] button:last-child');
      await waitForOrder(page, [FINVIZ, CAL, BROKER]);
      assert.equal(await page.$eval('[role="group"] button[aria-pressed="true"]', (b) => b.textContent), 'New');
      await shot(page, 'phone-trader-links-likes-new');
      await page.tap('[role="group"][aria-label="Order links by"] button:first-child');
    }
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
  // #329 suggestions.
  const rowNames = (page) => page.$$eval(`${nav} a[data-chat-page]`, (as) => as.map((a) => a.textContent.trim()));
  const suggestionRows = (page) => page.$$eval(`${nav} a[data-chat-page-suggestion]`, (as) => as.map((a) => [a.dataset.chatPageSuggestion, a.textContent.trim()]));
  const pagesApi = (page, method = 'GET', query = '', body) =>
    page.evaluate(async (m, q, b) => {
      const r = await fetch(`/api/chat/pages${q}`, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
      return [r.status, await r.json()];
    }, method, query, body);
  const phoneOpts = { width: 390, height: 844, isMobile: true, hasTouch: true };
  const backToList = async (page) => {
    await sleep(800);
    if (!(await page.evaluate(() => !!document.querySelector('section[aria-label="Longboard Chat"]')?.inert))) await page.tap('button[aria-label="Back to all chats"]');
    await page.waitForFunction(() => document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
  };
  const suggest = async (page, name, url, press = (selector) => page.click(selector)) => {
    await press(pageRow('new'));
    await page.waitForSelector('input[maxlength="40"]', { visible: true });
    await page.$eval('input[maxlength="40"]', (i) => i.select());
    await page.type('input[maxlength="40"]', name);
    if (url) {
      await clickText(page, 'A website');
      await page.waitForSelector('input[placeholder="https://"]', { visible: true });
      await page.$eval('input[placeholder="https://"]', (i) => i.select());
      await page.type('input[placeholder="https://"]', url);
    }
    await shot(page, 'desktop-member-suggest-form');
    await clickText(page, 'Suggest page');
    await page.waitForSelector(`::-p-text(“${name}” is waiting for approval)`);
    await page.waitForFunction((n, want) => [...document.querySelectorAll(`${n} a[data-chat-page-suggestion]`)].some((a) => a.textContent.includes(want)), {}, nav, name);
  };
  const allBefore = ['Market Dashboard', 'Trader Links', 'My Links', 'Calendar'];
  let scoutId;
  // Bob suggests a website on a computer: only he sees it, marked; it never opens as the page.
  {
    const { context, page, errors } = await open('bob@example.test');
    await page.waitForSelector(pageRow('new'), { visible: true });
    await page.click(pageRow('new'));
    await page.waitForSelector('::-p-text(An admin looks at it first)');
    assert.equal(await page.$eval('header h1', (h) => h.textContent), 'Suggest a page');
    await suggest(page, 'Scout Board', 'https://scout.example.com');
    await shot(page, 'desktop-member-suggest-sent');
    // The same checks as an admin's form.
    await page.type('input[maxlength="40"]', 'Bad address');
    await page.type('input[placeholder="https://"]', 'http://scout.example.com');
    await clickText(page, 'Suggest page');
    await page.waitForSelector('::-p-text(Start the address with https://)');
    assert.deepEqual(await suggestionRows(page), [['pending', 'Scout BoardWaiting for approval']]);
    assert.deepEqual(await rowNames(page), [...allBefore, 'Suggest a page'], 'still not among the real pages');
    await page.click(`${nav} a[data-chat-page-suggestion]`);
    await page.waitForSelector('[data-suggestion-status="pending"]');
    assert.equal(await page.$('iframe[title="Scout Board"]'), null, 'a waiting website is not framed');
    await shot(page, 'desktop-member-waiting');
    const [status, body] = await pagesApi(page);
    assert.equal(status, 200);
    assert.equal(body.pages.some((p) => p.name === 'Scout Board'), false);
    assert.deepEqual(body.waiting, [], 'members get no waiting list');
    scoutId = body.suggestions[0].id;
    // A member can't approve their own, or dismiss one that is still waiting.
    assert.equal((await pagesApi(page, 'PATCH', '', { id: scoutId, decision: 'approve' }))[0], 403);
    assert.equal((await pagesApi(page, 'DELETE', `?id=${scoutId}&dismiss=1`))[0], 404);
    assert.equal((await pagesApi(page, 'DELETE', `?id=${scoutId}`))[0], 403);
    assert.equal((await page.evaluate(async (id) => (await fetch(`/api/chat/pages/links?page=${id}`)).status, scoutId)), 404, 'its links route is closed');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Bob on a phone: a list page. With two more he is at the limit of three.
  {
    const { context, page, errors } = await open('bob@example.test', phoneOpts);
    await page.goto(`${base}/chat`);
    await page.waitForSelector(composer);
    await backToList(page);
    await page.$eval(pageRow('new'), (a) => a.scrollIntoView({ block: 'center' }));
    await shot(page, 'phone-member-sidebar');
    await page.tap(pageRow('new'));
    await page.waitForSelector('input[maxlength="40"]', { visible: true });
    await page.type('input[maxlength="40"]', 'Journal Club');
    await shot(page, 'phone-member-suggest-form');
    await clickText(page, 'Suggest page');
    await page.waitForSelector('::-p-text(“Journal Club” is waiting for approval)');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
    await page.tap('button[aria-label="Back to all chats"]');
    await page.waitForFunction(() => document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
    await page.waitForFunction((n) => document.querySelectorAll(`${n} a[data-chat-page-suggestion]`).length === 2, {}, nav);
    await page.$eval(`${nav} a[data-chat-page-suggestion]`, (a) => a.scrollIntoView({ block: 'center' }));
    await shot(page, 'phone-member-waiting');
    assert.equal((await pagesApi(page, 'POST', '', { name: 'Third', kind: 'links' }))[0], 201);
    const [limited, refused] = await pagesApi(page, 'POST', '', { name: 'Fourth', kind: 'links' });
    assert.equal(limited, 409);
    assert.match(refused.error, /already have 3 pages waiting/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Mallory, another member: nothing of Bob's shows, by sidebar, address or API.
  {
    const { context, page, errors } = await open('mallory@example.test');
    await page.waitForSelector(pageRow('new'), { visible: true });
    assert.deepEqual(await rowNames(page), [...allBefore, 'Suggest a page']);
    assert.deepEqual(await suggestionRows(page), []);
    const [, body] = await pagesApi(page);
    assert.ok(!JSON.stringify(body).includes('Scout Board') && !JSON.stringify(body).includes('Journal Club'), 'not in her API answer');
    assert.equal(await page.evaluate(async (id) => (await fetch(`/api/chat/pages/links?page=${id}`)).status, scoutId), 404);
    assert.equal((await pagesApi(page, 'PATCH', '', { id: scoutId, decision: 'approve' }))[0], 403, 'members cannot approve');
    assert.equal((await pagesApi(page, 'PATCH', '', { id: scoutId, decision: 'decline' }))[0], 403, 'members cannot decline');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Alice, an admin, on a computer: count and list; she approves one and declines one.
  {
    const { context, page, errors } = await open('alice@example.test');
    const waitingCount = `${nav} a[data-chat-page="waiting"] [data-pages-waiting-count]`;
    await page.waitForSelector(waitingCount, { visible: true });
    assert.equal(await page.$eval(waitingCount, (c) => c.textContent), '3');
    assert.deepEqual(await suggestionRows(page), [], "other people's suggestions are not in her sidebar");
    assert.ok(!(await rowNames(page)).includes('Scout Board'));
    await shot(page, 'desktop-admin-sidebar-count');
    // Folded, the Pages heading still carries the count.
    await page.click('[data-sidebar-fold="pages"]');
    await page.waitForSelector(`[data-sidebar-fold="pages"] [data-pages-waiting-count="3"]`);
    await shot(page, 'desktop-admin-folded-count');
    await page.click('[data-sidebar-fold="pages"]');
    await page.click(pageRow('waiting'));
    await page.waitForSelector('::-p-text(Suggested by Bob)');
    assert.equal(await page.$eval('header h1', (h) => h.textContent), 'Waiting for approval');
    assert.equal(await page.$eval('a[href="https://scout.example.com/"]', (a) => a.rel), 'noopener noreferrer');
    await shot(page, 'desktop-admin-waiting-list');
    const decide = async (name, button) => {
      const handle = await page.evaluateHandle((want, label) => {
        const row = [...document.querySelectorAll('ul li')].find((li) => li.textContent.includes(want));
        return [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
      }, name, button);
      await handle.click();
    };
    await decide('Scout Board', 'Approve');
    await page.waitForSelector('::-p-text(“Scout Board” is now in everyone’s Pages list.)');
    await page.waitForFunction((n) => [...document.querySelectorAll(`${n} a[data-chat-page]`)].some((a) => a.textContent.trim() === 'Scout Board'), {}, nav);
    await page.waitForFunction((c) => document.querySelector(c)?.textContent === '2', {}, waitingCount);
    await decide('Journal Club', 'Decline');
    await page.waitForSelector('::-p-text(“Journal Club” was declined.)');
    await page.waitForFunction((c) => document.querySelector(c)?.textContent === '1', {}, waitingCount);
    assert.ok(!(await rowNames(page)).includes('Journal Club'), 'declined never appears');
    await shot(page, 'desktop-admin-after-approval');
    // Deciding again is refused; the last one empties the list, count and row with it.
    const [, list] = await pagesApi(page);
    assert.equal(list.waiting.length, 1);
    assert.equal((await pagesApi(page, 'PATCH', '', { id: scoutId, decision: 'decline' }))[0], 409, 'an approved page cannot be declined');
    await decide('Third', 'Approve');
    await page.waitForSelector('::-p-text(Nothing is waiting for approval.)');
    await page.waitForFunction((c) => !document.querySelector(c), {}, waitingCount);
    // Scout Board now opens as a real page for her.
    await page.click(pageRow(list.pages.find((p) => p.name === 'Scout Board').slug));
    await page.waitForSelector('iframe[title="Scout Board"]', { visible: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Bob on a computer: Scout Board is his now like anyone's; Journal Club is marked Declined.
  {
    const { context, page, errors } = await open('bob@example.test');
    await page.waitForSelector(`${nav} a[data-chat-page-suggestion="declined"]`, { visible: true });
    assert.deepEqual(await suggestionRows(page), [['declined', 'Journal ClubDeclined']]);
    const names = await rowNames(page);
    assert.ok(names.includes('Scout Board') && names.includes('Third') && !names.includes('Journal Club'));
    await shot(page, 'desktop-member-after-decision');
    await page.click(`${nav} a[data-chat-page-suggestion="declined"]`);
    await page.waitForSelector('[data-suggestion-status="declined"]');
    await shot(page, 'desktop-member-declined');
    // Its id gives Bob no way in, and his Dismiss clears it.
    const [, body] = await pagesApi(page);
    const journalId = body.suggestions[0].id;
    assert.equal(await page.evaluate(async (id) => (await fetch(`/api/chat/pages/links?page=${id}`)).status, journalId), 404);
    await clickText(page, 'Dismiss');
    await page.waitForFunction((n) => !document.querySelector(`${n} a[data-chat-page-suggestion]`), {}, nav);
    await page.waitForSelector('input[maxlength="40"]', { visible: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Mallory on a phone: the approved page is in her sidebar, the declined one never was.
  {
    const { context, page, errors } = await open('mallory@example.test', phoneOpts);
    await page.goto(`${base}/chat`);
    await page.waitForSelector('textarea[aria-label="Message Social"]');
    await backToList(page);
    const names = await rowNames(page);
    assert.ok(names.includes('Scout Board') && !names.includes('Journal Club'));
    await page.$eval(pageRow('new'), (a) => a.scrollIntoView({ block: 'center' }));
    await shot(page, 'phone-after-approval-sidebar');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Alice on a phone: the waiting list works there too.
  {
    const { context: bob, page: bobPage } = await open('bob@example.test');
    assert.equal((await pagesApi(bobPage, 'POST', '', { name: 'Phone Check', kind: 'links' }))[0], 201);
    await bob.close();
    const { context, page, errors } = await open('alice@example.test', phoneOpts);
    await page.goto(`${base}/chat`);
    await page.waitForSelector(composer);
    await backToList(page);
    await page.$eval(pageRow('waiting'), (a) => a.scrollIntoView({ block: 'center' }));
    await shot(page, 'phone-admin-sidebar-count');
    await page.tap(pageRow('waiting'));
    await page.waitForSelector('::-p-text(Suggested by Bob)', { visible: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
    await shot(page, 'phone-admin-waiting-list');
    const approve = await page.waitForSelector('ul li ::-p-text(Approve)', { visible: true });
    const box = await approve.boundingBox();
    assert.ok(box.height >= 36, `Approve is a comfortable tap target (${box.height})`);
    await approve.tap();
    await page.waitForSelector('::-p-text(“Phone Check” is now in everyone’s Pages list.)');
    await shot(page, 'phone-admin-after-approval');
    await page.tap('button[aria-label="Back to all chats"]');
    await page.waitForFunction(() => document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
    await page.waitForFunction((n) => [...document.querySelectorAll(`${n} a[data-chat-page]`)].some((a) => a.textContent.trim() === 'Phone Check'), {}, nav);
    await page.$eval(pageRow('new'), (a) => a.scrollIntoView({ block: 'center' }));
    await shot(page, 'phone-admin-after-approval-sidebar');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS #329: members suggest (hidden, marked Waiting), admins see count and list, Approve shows for all, Decline never does, members refused, limit of 3.');
  console.log('PASS #321: Pages on desktop and phone; dashboard framed; shared/private link rules; Share; admin page; https only.');
  console.log('PASS #323: likes rank Trader Links (pinned on top, ties newest), one like per member, not your own, Top / New.');
} finally {
  await browser.close();
}
