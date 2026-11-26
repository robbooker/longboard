// #529 Booker Tube: the curated video page under Pages, on a computer and a phone, against the shared
// fixture (which runs the migration). chat-video-picks-preload.mjs answers every YouTube feed the
// server asks for, and this file catches everything a page asks of YouTube (stills are drawn here,
// the player is a blank stand-in), so nothing leaves the machine.
// - Before the first refresh the page isn't in Pages. The daily job (with the cron secret only)
//   reads 41 feeds, one of which fails, drops two Shorts, an old video and a hype title, keeps the
//   "shorting" video, and the page then appears for members under Pages at /chat?page=booker-tube.
// - The page: a lead pick, a row per area, everything newest first; each card says why it's there.
// - Area and topic filters, title search, sort; Reset returns to the front page.
// - Play: no player and no request to a video host until a press; one player at a time; Close.
// - Not for me hides with Undo and "Restore hidden"; More like this reorders; all of it, and the
//   last filter, survive a reload (this browser only).
// - A member has no admin controls and the admin routes refuse them. An admin adds a channel (by
//   @handle, checked against its feed), refreshes, and removes it again.
// - A phone: opens from the list, one column, no sideways scroll. Dark and light chat themes.
// VIDEO_PICKS_SHOTS=<dir> saves screenshots.
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { signIn } from './browser-login.mjs';
const base = 'http://localhost:3529', CRON = 'synthetic-local-cron', SLUG = 'booker-tube';
const shots = process.env.VIDEO_PICKS_SHOTS;
const feeds = JSON.parse(readFileSync(new URL('./chat-video-picks-feeds.json', import.meta.url), 'utf8')).channels;
const EXPECTED = Object.values(feeds).reduce((n, c) => n + c.videos.length, 0) + 1; // + the kept "shorting" video
const KEPT = 'SHORTINGok1', DROPPED = ['SHORTSurl01', 'SHORTStag01', 'TOOOLDvid01', 'HYPEvideo01'], ADDED = 'UCtestKitchen0000000001A';
const nav = 'nav[aria-label="Chat rooms"]', row = `${nav} a[data-chat-page="${SLUG}"]`, ready = '[data-video-picks="ready"]';
const composer = 'textarea[aria-label="Message LB"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIDEO_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|googlevideo\.com|google\.com)$/;
const still = (id) => { const hue = [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7); return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="hsl(${hue} 32% 38%)"/><circle cx="350" cy="130" r="90" fill="hsl(${(hue + 40) % 360} 40% 52%)"/><rect y="250" width="480" height="110" fill="hsl(${hue} 30% 24%)"/></svg>`; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const shot = async (page, name) => { if (shots) { await sleep(500); await page.screenshot({ path: `${shots}/${name}.png` }); } };

async function open(email, { viewport = { width: 1440, height: 1000 }, theme = 'light' } = {}) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.errors = []; page.videoRequests = []; page.stills = 0;
  page.on('pageerror', (e) => page.errors.push(e.message)); page.setDefaultTimeout(60000);
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    let url; try { url = new URL(r.url()); } catch { return r.continue(); }
    if (url.hostname === 'i.ytimg.com') { page.stills++; return r.respond({ status: 200, contentType: 'image/svg+xml', body: still(url.pathname.split('/')[2] ?? '') }); }
    if (/(^|\.)ytimg\.com$/.test(url.hostname)) { page.videoRequests.push(r.url()); return r.abort(); }
    if (VIDEO_HOST.test(url.hostname)) { page.videoRequests.push(r.url()); return r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#000"></body>' }); }
    r.continue();
  });
  await page.setViewport(viewport);
  await context.setCookie({ name: 'longboard-chat-theme', value: theme, domain: 'localhost', path: '/' });
  await page.evaluateOnNewDocument((theme) => { try { localStorage.setItem('longboard-public-chat-theme-v1', theme); } catch {} }, theme);
  await signIn(page, base, email, { composer });
  return page;
}
const api = (page, url, method = 'GET', body) => page.evaluate(async ({ url, method, body }) => {
  const r = await fetch(url, { method, cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, cache: r.headers.get('cache-control'), robots: r.headers.get('x-robots-tag'), etag: r.headers.get('etag'), body: await r.json().catch(() => null) };
}, { url, method, body });
const pagesRead = (page) => page.waitForSelector(`${nav} a[data-chat-page="new"]`);
// Every card on the page, in order: where it is, which video, and what it shows.
const cards = (page, section) => page.$$eval(`${section ? `[data-picks-section="${section}"] ` : ''}[data-picks-card]`, (els) => els.map((el) => ({
  id: el.dataset.picksCard, section: el.closest('[data-picks-section]').dataset.picksSection, reason: el.querySelector('[data-picks-reason]').textContent,
  watched: el.hasAttribute('data-watched'), liked: el.querySelector('[data-picks-action="like"]').getAttribute('aria-pressed') === 'true', frame: el.querySelector('iframe')?.getAttribute('src') ?? null,
  link: el.querySelector('a[target="_blank"]').getAttribute('href'), img: el.querySelector('img')?.getAttribute('src') ?? null, width: el.getBoundingClientRect().width })));
const ids = async (page, section) => (await cards(page, section)).map((c) => c.id);
const sections = (page) => page.$$eval('[data-picks-section]', (els) => els.map((el) => el.dataset.picksSection));
const press = (page, selector) => page.evaluate((selector) => { const el = document.querySelector(selector); el.scrollIntoView({ block: 'center' }); el.click(); }, selector);
const card = (section, id) => `[data-picks-section="${section}"] [data-picks-card="${id}"]`;
const noSideScroll = (page) => page.evaluate(() => { const el = document.querySelector('[data-video-picks]'); return document.documentElement.scrollWidth <= innerWidth && el.scrollWidth <= el.clientWidth; });
const colours = (page) => page.evaluate(() => { const el = document.querySelector('[data-video-picks]'), s = getComputedStyle(el), scope = el.closest('[data-theme]'); return { theme: scope?.dataset.theme, bg: s.backgroundColor, ink: s.color, token: getComputedStyle(scope).getPropertyValue('--chat-bg').trim() }; });
const openPage = async (page) => { await pagesRead(page); await page.waitForSelector(row); await press(page, row); await page.waitForSelector(ready); };

try {
  const bob = await open('bob@example.test'), alice = await open('alice@example.test');

  // Before the first refresh: no page in the sidebar, an empty list from the route, the job needs its secret.
  await pagesRead(bob);
  assert.equal(await bob.$(row), null, 'no Booker Tube row before there are videos');
  let read = await api(bob, '/api/chat/video-picks');
  assert.equal(read.status, 200); assert.deepEqual(read.body.videos, []); assert.equal(read.body.canManage, false); assert.equal(read.body.title, 'Booker Tube');
  assert.equal((await fetch(`${base}/api/cron/video-picks`)).status, 401, 'the job refuses a caller without the secret');
  assert.equal((await fetch(`${base}/api/cron/video-picks`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${base}/api/chat/video-picks`)).status, 401, 'signed-out visitors read nothing');

  // The daily job.
  const run = await (await fetch(`${base}/api/cron/video-picks`, { headers: { authorization: `Bearer ${CRON}` } })).json();
  assert.deepEqual({ stored: run.stored, reason: run.reason, channels: run.channels, succeeded: run.succeeded, failed: run.failed, videos: run.videos, shorts: run.shorts, old: run.old, lowScore: run.lowScore, carried: run.carried },
    { stored: true, reason: 'stored', channels: 41, succeeded: 40, failed: 1, videos: EXPECTED, shorts: 2, old: 1, lowScore: 1, carried: 0 }, 'one bad feed never fails the run; Shorts, old and hype videos are left out');

  // A member's read: cached for five minutes, never indexed, no phrases or weights, and 304 when unchanged.
  read = await api(bob, '/api/chat/video-picks');
  assert.equal(read.status, 200); assert.equal(read.cache, 'private, max-age=300'); assert.equal(read.robots, 'noindex, nofollow'); assert.ok(read.etag);
  assert.equal(read.body.videos.length, EXPECTED); assert.equal(read.body.areas.length, 5); assert.equal(read.body.topics.length, 24);
  assert.deepEqual(Object.keys(read.body.topics[0]).sort(), ['area', 'id', 'label'], 'topics carry no phrases or weights');
  assert.ok(!JSON.stringify(read.body).includes('keywords') && !JSON.stringify(read.body).includes('penalt'), 'nothing about how the list is scored');
  const data = read.body, byId = new Map(data.videos.map((v) => [v.id, v])), label = (id) => data.topics.find((t) => t.id === id)?.label;
  assert.ok(byId.has(KEPT), '"shorting" is not a Short'); for (const id of DROPPED) assert.ok(!byId.has(id), `${id} is left out`);
  assert.equal(await bob.evaluate(async (etag) => (await fetch('/api/chat/video-picks', { cache: 'no-store', headers: { 'if-none-match': etag } })).status, read.etag), 304, 'unchanged list: 304');

  // Bob opens it from Pages.
  await bob.reload(); await openPage(bob);
  assert.equal(await bob.$eval(row, (a) => a.textContent.trim()), 'Booker Tube'); assert.equal(await bob.$eval(row, (a) => a.getAttribute('aria-current')), 'page');
  assert.equal(new URL(bob.url()).searchParams.get('page'), SLUG, 'a stable address');
  assert.equal(await bob.$eval(`${ready} h2`, (h) => h.textContent), 'Booker Tube'); assert.equal(await bob.title(), 'Booker Tube', 'the tab is named for the page');
  assert.match(await bob.$eval(ready, (el) => el.textContent), new RegExp(`${EXPECTED} picks from the last 90 days`));
  assert.deepEqual(await sections(bob), ['lead', 'trading', 'building', 'business', 'ideas', 'fun', 'everything'], 'lead, a row per area, then everything');
  let all = await cards(bob);
  const lead = all.filter((c) => c.section === 'lead'); assert.equal(lead.length, 1);
  assert.equal(lead[0].id, data.videos[0].id, 'the lead is the best match');
  for (const area of data.areas.map((a) => a.id)) { const rowCards = all.filter((c) => c.section === area); assert.ok(rowCards.length >= 1 && rowCards.length <= 3, `${area} row has ${rowCards.length}`); assert.ok(rowCards.every((c) => byId.get(c.id).area === area && c.id !== lead[0].id)); }
  const everything = all.filter((c) => c.section === 'everything');
  assert.equal(everything.length, EXPECTED);
  assert.deepEqual(everything.map((c) => c.id), [...data.videos].sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).map((v) => v.id), 'everything, newest first');
  for (const c of all) { assert.match(c.reason, /^.{3,60} · (today|yesterday|\d+ (days|weeks|months?) ago)$/, `why it's here: ${c.reason}`); assert.equal(c.link, `https://www.youtube.com/watch?v=${c.id}`); assert.equal(c.img, `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`); assert.equal(c.frame, null); }
  assert.equal(everything.find((c) => c.id === KEPT).reason, `${label('shorting-parabolic-runners')} · yesterday`);
  assert.equal(await bob.$('iframe'), null, 'no player anywhere before a press'); assert.deepEqual(bob.videoRequests, [], 'opening the page asks nothing of a video host');
  assert.equal(await bob.$('[data-picks-manage]'), null, 'a member sees no admin controls');
  assert.equal(await bob.evaluate(() => /export state|import state|dark mode|light mode/i.test(document.querySelector('[data-video-picks]').textContent)), false, 'no export/import or theme switch of its own');
  assert.ok(await noSideScroll(bob));
  await shot(bob, 'page-desktop');

  // Filters, search and sort.
  await press(bob, '[data-picks-area="trading"]'); await bob.waitForSelector('[data-picks-section="filtered"]');
  const trading = data.videos.filter((v) => v.area === 'trading');
  assert.deepEqual(await sections(bob), ['filtered']); assert.deepEqual(await ids(bob), trading.map((v) => v.id), 'an area, best match first');
  assert.equal(await bob.$eval('[data-picks-area="trading"]', (b) => b.getAttribute('aria-pressed')), 'true');
  assert.deepEqual(await bob.$$eval('[data-picks-topic] option', (o) => o.map((x) => x.value)), ['all', ...data.topics.filter((t) => t.area === 'trading').map((t) => t.id)], 'topics of that area only');
  await shot(bob, 'page-area');
  await bob.select('[data-picks-topic]', 'shorting-parabolic-runners');
  const shorting = trading.filter((v) => v.topics.includes('shorting-parabolic-runners')); assert.ok(shorting.length >= 1 && shorting.length < trading.length);
  await bob.waitForFunction((n) => document.querySelectorAll('[data-picks-card]').length === n, {}, shorting.length); assert.deepEqual(await ids(bob), shorting.map((v) => v.id), 'a topic');
  await bob.select('[data-picks-topic]', 'all'); await bob.select('[data-picks-sort]', 'newest');
  await bob.waitForFunction((n) => document.querySelectorAll('[data-picks-card]').length === n, {}, trading.length);
  assert.deepEqual(await ids(bob), [...trading].sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).map((v) => v.id), 'newest first');
  await bob.type('[data-video-picks] input[type="search"]', 'SHORTING par');
  await bob.waitForFunction(() => document.querySelectorAll('[data-picks-card]').length === 1); assert.deepEqual(await ids(bob), [KEPT], 'title search, any case');
  await bob.type('[data-video-picks] input[type="search"]', 'zzz'); await bob.waitForFunction(() => /No videos match/.test(document.querySelector('[data-video-picks]').textContent));
  await bob.evaluate(() => [...document.querySelectorAll('[data-video-picks] button')].find((b) => b.textContent === 'Reset').click());
  await bob.waitForSelector('[data-picks-section="lead"]'); assert.equal(await bob.$eval('[data-video-picks] input[type="search"]', (i) => i.value), '');

  // Play: only after a press, in place, one at a time.
  const second = everything.find((c) => c.id !== lead[0].id).id;
  const box = await bob.$eval(`${card('lead', lead[0].id)} [data-recording-video]`, (el) => { const b = el.getBoundingClientRect(); return [b.width, b.height]; });
  await bob.click(`${card('lead', lead[0].id)} [data-recording-video] button`); await bob.waitForSelector(`${card('lead', lead[0].id)} iframe`);
  const embed = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  let frames = await bob.$$eval('iframe', (f) => f.map((x) => ({ src: x.getAttribute('src'), sandbox: x.getAttribute('sandbox'), referrer: x.getAttribute('referrerpolicy') })));
  assert.deepEqual(frames, [{ src: embed(lead[0].id), sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox', referrer: 'strict-origin-when-cross-origin' }], "the chat's own player card, privacy-enhanced address");
  assert.deepEqual(await bob.$eval(`${card('lead', lead[0].id)} [data-recording-video]`, (el) => { const b = el.getBoundingClientRect(); return [b.width, b.height]; }), box, 'the player takes the picture’s place');
  for (const end = Date.now() + 10000; !bob.videoRequests.length; await sleep(50)) assert.ok(Date.now() < end, 'the player was asked for');
  assert.deepEqual(bob.videoRequests, [embed(lead[0].id)], 'only the player address, only after the press');
  assert.ok((await cards(bob, 'lead'))[0].watched, 'playing marks it watched'); assert.equal((await cards(bob, 'lead'))[0].id, lead[0].id, 'and the lead stays put while it plays');
  await shot(bob, 'page-playing');
  await press(bob, `${card('everything', second)} [data-recording-video] button`); await bob.waitForSelector(`${card('everything', second)} iframe`);
  assert.deepEqual(await bob.$$eval('iframe', (f) => f.map((x) => x.getAttribute('src'))), [embed(second)], 'one player at a time');
  await bob.evaluate(() => [...document.querySelectorAll('[data-video-picks] button')].find((b) => b.textContent === 'Close player').click());
  await bob.waitForFunction(() => !document.querySelector('iframe'));
  await sleep(300); assert.deepEqual(bob.videoRequests, [embed(lead[0].id), embed(second)], 'nothing plays next');
  // With the player closed the order catches up: the lead is now the best pick not yet watched.
  const nextLead = data.videos.find((v) => v.id !== lead[0].id && v.id !== second).id;
  await bob.waitForSelector(card('lead', nextLead));

  // Not for me, Undo, and Restore hidden.
  const gone = [...data.videos].reverse().find((v) => ![lead[0].id, second, nextLead].includes(v.id));
  const stats = () => bob.$eval('[data-picks-stats]', (el) => el.textContent);
  assert.equal(await stats(), `${EXPECTED} videos · 2 watched`);
  await press(bob, `${card('everything', gone.id)} [data-picks-action="hide"]`);
  await bob.waitForFunction((id) => !document.querySelector(`[data-picks-card="${id}"]`), {}, gone.id);
  assert.equal(await stats(), `${EXPECTED - 1} videos · 2 watched`); assert.match(await bob.$eval('[data-picks-toast]', (el) => el.textContent), new RegExp(`Hidden.*${gone.channel.replace(/[.*+?^${}()|[\\]\\\\]/g, '.')}.*Undo`));
  await bob.evaluate(() => document.querySelector('[data-picks-toast] button').click());
  await bob.waitForSelector(card('everything', gone.id)); assert.equal(await stats(), `${EXPECTED} videos · 2 watched`); assert.equal(await bob.$('[data-picks-restore]'), null);
  await press(bob, `${card('everything', gone.id)} [data-picks-action="hide"]`); await bob.waitForSelector('[data-picks-restore]');
  assert.equal(await bob.$eval('[data-picks-restore]', (el) => el.textContent), 'Restore 1 hidden');

  // More like this reorders the best-match list (the same sums the page does, worked out here).
  await press(bob, '[data-picks-area="fun"]'); await bob.waitForSelector('[data-picks-section="filtered"]');
  const fun = data.videos.filter((v) => v.area === 'fun'), before = await ids(bob); assert.deepEqual(before, fun.map((v) => v.id));
  const after = (liked) => [...fun].map((v) => ({ v, s: v.score + (v.channelId === liked.channelId ? 1.5 : 0) + (v.topics.includes(liked.primaryTopic) ? 1 : 0) + (v.id === liked.id ? 1.5 : 0) }))
    .sort((a, b) => b.s - a.s || Date.parse(b.v.published) - Date.parse(a.v.published)).map((x) => x.v.id);
  const liked = [...fun].reverse().find((v) => after(v).join() !== before.join()); assert.ok(liked, 'a like that changes the order exists');
  await press(bob, `${card('filtered', liked.id)} [data-picks-action="like"]`);
  await bob.waitForFunction((want) => [...document.querySelectorAll('[data-picks-card]')].map((el) => el.dataset.picksCard).join() === want, {}, after(liked).join());
  assert.ok(after(liked).indexOf(liked.id) < before.indexOf(liked.id), 'the liked video moved up');
  assert.equal((await cards(bob)).find((c) => c.id === liked.id).liked, true);

  // All of it is kept in this browser: a reload brings back the filter, the like, watched and hidden.
  await bob.reload(); await bob.waitForSelector(ready); await bob.waitForSelector('[data-picks-section="filtered"]');
  assert.equal(await bob.$eval('[data-picks-area="fun"]', (b) => b.getAttribute('aria-pressed')), 'true'); assert.deepEqual(await ids(bob), after(liked), 'the liked order is back');
  assert.equal((await cards(bob)).find((c) => c.id === liked.id).liked, true); assert.equal(await bob.$eval('[data-picks-restore]', (el) => el.textContent), 'Restore 1 hidden');
  await press(bob, '[data-picks-area="all"]'); await bob.waitForSelector('[data-picks-section="lead"]');
  all = await cards(bob, 'everything'); assert.deepEqual(all.filter((c) => c.watched).map((c) => c.id).sort(), [lead[0].id, second].sort(), 'watched videos stay dimmed');
  assert.ok(!all.some((c) => c.id === gone.id));
  await press(bob, '[data-picks-restore]'); await bob.waitForSelector(card('everything', gone.id)); assert.equal(await bob.$('[data-picks-restore]'), null);
  assert.equal(await bob.evaluate(() => Object.keys(localStorage).filter((k) => /booker-tube/.test(k)).length), 1, 'one key in this browser');

  // The admin routes refuse a member.
  for (const [url, method, body] of [['/api/chat/video-picks/channels', 'GET'], ['/api/chat/video-picks/channels', 'POST', { channel: ADDED, area: 'building' }], [`/api/chat/video-picks/channels?id=${ADDED}`, 'DELETE'], ['/api/chat/video-picks/refresh', 'POST']])
    assert.equal((await api(bob, url, method, body)).status, 403, `member ${method} ${url}`);

  // Alice, an admin: channels and refresh.
  await alice.reload(); await openPage(alice);
  assert.equal((await api(alice, '/api/chat/video-picks')).cache, 'private, no-store', 'an admin always reads the current list');
  await alice.waitForSelector('[data-picks-manage-toggle]'); await press(alice, '[data-picks-manage-toggle]');
  await alice.waitForSelector('[data-picks-channels="41"]');
  assert.match(await alice.$eval('[data-picks-last]', (el) => el.textContent), new RegExp(`Last refresh: ${EXPECTED} videos from 40 of 41 channels · couldn’t read David Capablanca`));
  const note = () => alice.$eval('[data-picks-note]', (el) => el.textContent);
  const add = async (value, wait) => { await alice.click('[data-picks-channel-input]', { clickCount: 3 }); await alice.keyboard.press('Backspace'); await alice.type('[data-picks-channel-input]', value);
    await alice.evaluate(() => [...document.querySelectorAll('[data-picks-manage] button')].find((b) => b.textContent === 'Add channel').click()); await alice.waitForFunction((wait) => new RegExp(wait).test(document.querySelector('[data-picks-note]')?.textContent ?? ''), {}, wait); return note(); };
  await add('not a channel', 'Paste a channel id'); await add('https://example.test/channel/UCtestKitchen0000000001A', 'Paste a channel id');
  await add('UCnoSuchChannel000000000', 'no public channel'); await add('@nobodyhere', 'Couldn.t find @nobodyhere');
  await add('UCg3B_joekBGJ1s_4fRjsMKA', 'already on the list');
  assert.equal(await alice.$('[data-picks-channels="41"]') !== null, true, 'nothing was saved by the refused tries');
  await alice.select('[data-picks-manage] form select', 'building');
  assert.match(await add('youtube.com/@testkitchen', 'Added'), /Added Test Kitchen & Co\. Its videos join the page at the next refresh\./);
  await alice.waitForSelector('[data-picks-channels="42"]'); assert.equal(await alice.$eval(`[data-picks-channel="${ADDED}"]`, (li) => li.textContent.includes('Test Kitchen & Co') && li.textContent.includes('Building')), true);
  await add(ADDED, 'already on the list');
  await press(alice, '[data-picks-refresh]');
  await alice.waitForFunction(() => /Refreshed:/.test(document.querySelector('[data-picks-note]')?.textContent ?? ''), { timeout: 120000 });
  assert.equal(await note(), `Refreshed: ${EXPECTED + 1} videos from 41 of 42 channels (1 couldn’t be read and kept their last videos).`);
  await alice.waitForSelector(card('everything', 'ADDEDvideo1')); await shot(alice, 'page-admin');
  await press(alice, `[data-picks-channel="${ADDED}"] button`); await alice.waitForFunction((id) => /^Remove Test Kitchen/.test(document.querySelector(`[data-picks-channel="${id}"] button`)?.textContent ?? ''), {}, ADDED);
  await press(alice, `[data-picks-channel="${ADDED}"] button`); await alice.waitForSelector('[data-picks-channels="41"]');
  await alice.waitForFunction(() => !document.querySelector('[data-picks-card="ADDEDvideo1"]')); assert.match(await note(), /Removed Test Kitchen & Co and its videos\./);
  assert.equal((await api(alice, '/api/chat/video-picks')).body.videos.length, EXPECTED);

  // A phone: from the list, one column, nothing wider than the screen, and play works.
  const phone = await open('bob@example.test', { viewport: { width: 390, height: 844, isMobile: true, hasTouch: true }, theme: 'dark' });
  await sleep(800);
  if (!(await phone.evaluate(() => !!document.querySelector('section[aria-label="Longboard Chat"]')?.inert))) await phone.tap('button[aria-label="Back to all chats"]');
  await phone.waitForFunction(() => document.querySelector('section[aria-label="Longboard Chat"]')?.inert);
  await pagesRead(phone); await phone.waitForSelector(row);
  await phone.evaluate((row) => document.querySelector(row).scrollIntoView({ block: 'center' }), row); await sleep(300); await phone.tap(row); await phone.waitForSelector(ready);
  assert.equal(new URL(phone.url()).searchParams.get('page'), SLUG); assert.ok(await noSideScroll(phone), 'no sideways scroll on a phone');
  const phoneCards = await cards(phone, 'everything'); assert.ok(phoneCards.every((c) => c.width > 300 && c.width <= 390), 'one column of cards');
  assert.equal(await phone.$('[data-picks-manage]'), null); assert.deepEqual(phone.videoRequests, []);
  const phoneLead = (await cards(phone, 'lead'))[0].id;
  await shot(phone, 'page-phone');
  await phone.tap(`${card('lead', phoneLead)} [data-recording-video] button`); await phone.waitForSelector(`${card('lead', phoneLead)} iframe`);
  assert.deepEqual(await phone.$$eval('iframe', (f) => f.map((x) => x.getAttribute('src'))), [embed(phoneLead)]); assert.ok(await noSideScroll(phone));
  for (const width of [320, 768]) { await phone.setViewport({ width, height: 900, isMobile: true, hasTouch: true }); await sleep(250); assert.ok(await noSideScroll(phone), `no overflow at ${width}`); }

  // The page wears the chat's look: its background is the chat's own token in dark and in light.
  const dark = await colours(phone), light = await colours(bob);
  assert.equal(dark.theme, 'dark'); assert.equal(light.theme, 'light'); assert.notEqual(dark.bg, light.bg); assert.notEqual(dark.ink, light.ink);
  const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number), lum = (c) => rgb(c).reduce((n, v) => n + v, 0);
  assert.ok(lum(dark.bg) < 200 && lum(dark.ink) > 500, `dark: ${dark.bg} / ${dark.ink}`); assert.ok(lum(light.bg) > 560 && lum(light.ink) < 300, `light: ${light.bg} / ${light.ink}`);
  for (const look of [dark, light]) assert.equal(await bob.evaluate((token) => { const d = document.createElement('i'); d.style.color = token; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, look.token), look.bg, 'the page background is --chat-bg');
  if (shots) { const night = await open('bob@example.test', { theme: 'dark' }); await openPage(night); await shot(night, 'page-dark'); assert.deepEqual(night.errors, []); }
  assert.equal(bob.stills > 0 && phone.stills > 0, true, 'stills were drawn here, not fetched');
  for (const page of [bob, alice, phone]) assert.deepEqual(page.errors, [], 'no page errors');
  console.log('chat-video-picks-browser: passed');
} finally {
  await browser.close();
}
