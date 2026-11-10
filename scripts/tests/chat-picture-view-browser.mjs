// #414 the larger view of a person's picture and name, end to end on synthetic accounts and a
// generated picture. Run with chat-avatars-fixture.mjs. Covers: opening it from a picture and from a
// name in a room, a thread, a DM, the Member List, search results and an @tag; the 256px file drawn
// sharp; the initials tile for someone with no picture; closing with X, a click outside and Escape
// (which leaves the thread and the Member List open); focus going in and back; the keyboard; the
// private message that a name used to open, now a button in the view; the four themes; and a phone.
// CHAT_SHOT_DIR: also saves picture-view-*.png there.
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { signIn } from './browser-login.mjs';
const base = process.env.CHAT_TEST_URL || 'http://localhost:3410';
const fixture = process.env.CHAT_FIXTURE_URL || 'http://127.0.0.1:54610';
const shots = process.env.CHAT_SHOT_DIR;
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];
const VIEW = 'dialog[data-member-picture-view][open]', THREAD = 'aside[aria-label="Comment replies"]', MEMBERS = 'dialog[open] [aria-label="Room members"]', SEARCH = 'section[aria-label="Search chat"]', DM = 'section[aria-label="Private conversation"]';
const label = name => `View ${name}’s profile picture`;
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/picture-view-${name}.png` }); };
async function login(email, width, height) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  await page.setViewport(width < 600 ? { width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : { width, height });
  page.on('pageerror', e => errors.push(`${email}: ${e.message}`));
  await signIn(page, base, email);
  return page;
}
// The first visible element matching the selector (and, when given, with exactly this text or in the message that has it).
async function visible(page, selector, text) {
  const find = (s, t) => {
    // (A copy of a room kept off to the side of the screen does not count.)
    const all = [...document.querySelectorAll(s)].filter(e => { const r = e.getBoundingClientRect(); return e.checkVisibility() && r.width > 1 && r.left >= 0 && r.right <= innerWidth && (t == null || e.textContent.trim() === t || e.closest('article')?.textContent.includes(t)); });
    // One already on screen when there is one, so clicking it does not scroll the conversation.
    return all.find(e => { const r = e.getBoundingClientRect(); return r.top >= 100 && r.bottom <= innerHeight - 120; }) ?? all[0];
  };
  await page.waitForFunction(find, { timeout: 30000 }, selector, text ?? null);
  return (await page.evaluateHandle(find, selector, text ?? null)).asElement();
}
const click = async (page, selector, text) => (await visible(page, selector, text)).click();
// What the open view shows.
const view = page => page.evaluate(VIEW => {
  const d = document.querySelector(VIEW);
  if (!d) return null;
  const r = d.getBoundingClientRect(), tile = d.querySelector('[data-avatar]'), t = tile.getBoundingClientRect(), img = tile.querySelector('img');
  return {
    kind: tile.dataset.avatar, initials: tile.textContent, name: d.querySelector('h2').textContent, labelled: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent,
    src: img?.getAttribute('src') ?? null, natural: img ? img.naturalWidth : null, alt: img?.alt ?? null, width: t.width, height: t.height, tileColor: getComputedStyle(tile).backgroundColor,
    buttons: [...d.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent), focus: document.activeElement?.getAttribute('aria-label'),
    inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, modal: d.matches(':modal'), background: getComputedStyle(d).backgroundColor,
  };
}, VIEW);
async function open(page, selector, text) {
  await click(page, selector, text);
  await page.waitForSelector(VIEW, { timeout: 30000 });
  await page.waitForFunction(VIEW => { const i = document.querySelector(`${VIEW} img`); return !i || (i.complete && i.naturalWidth > 0); }, { timeout: 30000 }, VIEW);
  return view(page);
}
const closed = page => page.waitForFunction(VIEW => !document.querySelector(VIEW), { timeout: 10000 }, VIEW);
const escape = async page => { await page.keyboard.press('Escape'); await closed(page); };
const focused = page => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.title || document.activeElement?.tagName);
const roomTop = page => page.evaluate(() => { let n = [...document.querySelectorAll('article[id^="chat-message-"]')].find(a => a.checkVisibility()); while (n && n.scrollHeight <= n.clientHeight + 4) n = n.parentElement; return Math.round(n.scrollTop); });
// On screen and wired up by React (a server-drawn button that is not yet live does not count).
const hydrated = (page, selector) => page.waitForFunction(s => [...document.querySelectorAll(s)].some(e => e.checkVisibility() && Object.keys(e).some(k => k.startsWith('__reactProps$'))), { timeout: 60000 }, selector);
// The conversation has finished loading and moving to its newest message.
async function settled(page) {
  for (let last = -1, same = 0; same < 3;) { const top = await roomTop(page); same = top === last ? same + 1 : 0; last = top; await new Promise(r => setTimeout(r, 400)); }
  return roomTop(page);
}
const room = async page => { await page.goto(`${base}/chat`); await page.waitForSelector('textarea[aria-label^="Message "]', { visible: true, timeout: 60000 }); await hydrated(page, `article button[aria-label="${label('Alice')}"]`); };

try {
  const alice = await login('alice@example.test', 1280, 900);
  // Alice gets a picture (a drawn face on a gradient); Bob and Mallory have none.
  const face = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><defs><linearGradient id="g"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><rect width="900" height="900" fill="url(#g)"/><circle cx="450" cy="380" r="170" fill="#fde7c8"/><circle cx="390" cy="350" r="18" fill="#333"/><circle cx="510" cy="350" r="18" fill="#333"/><path d="M380 440 Q450 500 520 440" stroke="#333" stroke-width="12" fill="none"/></svg>`;
  const saved = await alice.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const post = body => fetch('/api/chat/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const start = await (await post({ action: 'start', byteSize: bytes.length })).json();
    await fetch(start.url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    await post({ action: 'preview', uploadId: start.uploadId });
    return (await post({ action: 'save', uploadId: start.uploadId })).json();
  }, (await sharp(Buffer.from(face)).jpeg().toBuffer()).toString('base64'));
  const picture = saved.member.avatar_path;
  assert.match(picture, /^[0-9a-f-]{36}$/);
  await room(alice);
  await shot(alice, 'before-desktop');

  // ---- A room: the small picture opens the view with the 256px file, drawn no wider than it is ----
  const top = await settled(alice), url = alice.url();
  let v = await open(alice, `article button[aria-label="${label('Alice')}"]`);
  assert.equal(v.kind, 'picture');
  assert.ok(v.src.endsWith(`/storage/v1/object/public/chat-avatars/${picture}-256.webp`), v.src);
  assert.equal(v.natural, 256);
  assert.ok(v.width >= 240 && v.width <= 256 && Math.abs(v.width - v.height) < 1, `${v.width} x ${v.height}`);
  assert.equal(v.alt, 'Alice’s profile picture');
  assert.equal(v.name, 'Alice');
  assert.equal(v.labelled, 'Alice');
  assert.ok(v.modal && v.inside);
  // Focus moves into the view; your own view has nothing to message.
  assert.equal(v.focus, 'Close');
  assert.deepEqual(v.buttons, ['Close']);
  await shot(alice, 'picture-desktop');
  // Escape closes it, focus returns to the picture, and the conversation has not moved.
  await escape(alice);
  assert.equal(await focused(alice), label('Alice'));
  assert.equal(await roomTop(alice), top);
  assert.equal(alice.url(), url);

  // ---- A name: someone with no picture shows their initials tile, in the colour of their small one ----
  const small = await (await visible(alice, `article button[aria-label="${label('Mallory')}"]`)).evaluate(e => ({ color: getComputedStyle(e).backgroundColor, text: e.textContent }));
  v = await open(alice, `article button[title="${label('Mallory')}"]`, 'Mallory');
  assert.equal(v.kind, 'initials');
  assert.equal(v.initials, small.text);
  assert.equal(v.tileColor, small.color);
  assert.equal(v.name, 'Mallory');
  assert.ok(v.width >= 240 && Math.abs(v.width - v.height) < 1);
  // What her name used to do at once is a button here.
  assert.deepEqual(v.buttons, ['Close', 'Message privately']);
  await shot(alice, 'initials-desktop');
  // A click on the card keeps it open; a click outside closes it.
  await alice.click(`${VIEW} h2`);
  assert.ok(await alice.$(VIEW));
  await alice.mouse.click(30, 450);
  await closed(alice);
  assert.equal(await focused(alice), label('Mallory'));
  // The X closes it.
  await open(alice, `article button[title="${label('Mallory')}"]`, 'Mallory');
  await alice.click(`${VIEW} button[aria-label="Close"]`);
  await closed(alice);
  // The keyboard: the name is a real button (Enter and Space open it) and Tab stays inside the view.
  for (const key of ['Enter', 'Space']) {
    await (await visible(alice, `article button[title="${label('Mallory')}"]`, 'Mallory')).focus();
    await alice.keyboard.press(key);
    await alice.waitForSelector(VIEW);
    await alice.keyboard.press('Tab');
    assert.equal(await alice.evaluate(() => document.activeElement.textContent), 'Message privately');
    await alice.keyboard.press('Tab');
    assert.ok(await alice.evaluate(VIEW => document.activeElement === document.body || !!document.activeElement.closest(VIEW), VIEW), 'Tab stays in the view');
    await escape(alice);
  }
  assert.equal(await roomTop(alice), top);
  // "Message privately" does what the name did before: opens the private message to her.
  await open(alice, `article button[title="${label('Mallory')}"]`, 'Mallory');
  await click(alice, `${VIEW} button`, 'Message privately');
  await closed(alice);
  await alice.waitForFunction(DM => document.querySelector(DM)?.textContent.includes('Send one message to Mallory'), { timeout: 30000 }, DM);

  // ---- A thread: names and pictures open the view; Escape closes the view and leaves the thread ----
  await room(alice);
  const reply = () => [...document.querySelectorAll('article[id^="chat-message-"]')].filter(a => a.checkVisibility() && a.textContent.includes('Happy to compare notes')).flatMap(a => [...a.querySelectorAll('button')]).find(b => b.textContent.includes('Reply') || b.textContent.includes('repl'));
  await alice.waitForFunction(reply, { timeout: 30000 }).catch(async e => { console.log(await alice.evaluate(() => [...document.querySelectorAll('article[id^="chat-message-"]')].filter(a => a.textContent.includes('Happy to compare notes')).map(a => a.checkVisibility() + ' ' + [...a.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent).join(' | ')).join('\n'))); throw e; });
  await alice.evaluate(`(${reply})().click()`);
  await alice.waitForSelector(THREAD, { visible: true, timeout: 30000 });
  v = await open(alice, `${THREAD} button[title="${label('Bob')}"]`, 'Bob');
  assert.equal(v.kind, 'initials');
  assert.equal(v.name, 'Bob');
  assert.deepEqual(v.buttons, ['Close']);
  await escape(alice);
  assert.ok(await alice.$eval(THREAD, e => e.checkVisibility()), 'the thread stays open');
  assert.equal(await focused(alice), label('Bob'));
  v = await open(alice, `${THREAD} button[aria-label="${label('Bob')}"]`);
  assert.equal(v.name, 'Bob');
  await shot(alice, 'thread-desktop');
  await escape(alice);
  await click(alice, `${THREAD} button[aria-label="Close replies"]`);

  // ---- The Member List: a row opens the view (yourself included); the list stays open behind it ----
  await click(alice, 'button[aria-label="Room info"]');
  await click(alice, 'button', 'Member List');
  await alice.waitForSelector(MEMBERS, { timeout: 60000 });
  v = await open(alice, `${MEMBERS} button[title="${label('Bob')}"]`);
  assert.equal(v.kind, 'initials');
  assert.deepEqual(v.buttons, ['Close', 'Message privately']);
  await shot(alice, 'member-list-desktop');
  await escape(alice);
  assert.ok(await alice.$(MEMBERS), 'the Member List stays open');
  assert.equal(await focused(alice), label('Bob'));
  v = await open(alice, `${MEMBERS} button[title="${label('Alice')}"]`);
  assert.equal(v.kind, 'picture');
  assert.ok(v.src.endsWith(`${picture}-256.webp`));
  assert.deepEqual(v.buttons, ['Close']);
  await escape(alice);
  // From the list, the button closes the list and opens the private message, as a row did before.
  await open(alice, `${MEMBERS} button[title="${label('Bob')}"]`);
  await click(alice, `${VIEW} button`, 'Message privately');
  await alice.waitForFunction(M => !document.querySelector(M), { timeout: 10000 }, MEMBERS);
  await alice.waitForSelector(DM, { visible: true, timeout: 30000 });

  // ---- A DM: the sender's name opens the view ----
  v = await open(alice, `${DM} button[title="${label('Bob')}"]`);
  assert.equal(v.name, 'Bob');
  assert.equal(v.kind, 'initials');
  assert.deepEqual(v.buttons, ['Close']);
  await shot(alice, 'dm-desktop');
  await escape(alice);
  assert.ok(await alice.$eval(DM, e => e.checkVisibility()), 'the DM stays open');

  // ---- Search results: the name on a result opens the view and search stays where it was ----
  await room(alice);
  await alice.evaluate(() => [...document.querySelectorAll('button')].find(b => b.checkVisibility() && /Search chat/.test(b.getAttribute('aria-label') || b.textContent)).click());
  await alice.waitForSelector(`${SEARCH} input`, { visible: true, timeout: 30000 });
  await alice.select(`${SEARCH} select[aria-label="Search method"]`, await alice.$eval(`${SEARCH} select[aria-label="Search method"]`, s => [...s.options].find(o => /Words/.test(o.textContent)).value));
  await alice.type(`${SEARCH} input`, 'morning');
  await alice.keyboard.press('Enter');
  v = await open(alice, `${SEARCH} button[title="${label('Alice')}"]`);
  assert.equal(v.kind, 'picture');
  assert.ok(v.src.endsWith(`${picture}-256.webp`));
  await escape(alice);
  v = await open(alice, `${SEARCH} button[title="${label('Bob')}"]`);
  assert.equal(v.kind, 'initials');
  assert.deepEqual(v.buttons, ['Close']);
  await shot(alice, 'search-desktop');
  await escape(alice);
  assert.ok(await alice.$eval(SEARCH, e => e.checkVisibility()), 'search stays open');

  // ---- The four themes: the view takes the theme's own panel and text colours ----
  // (The page reads the account's saved theme once after it loads, and that read wins over a
  // theme set before it lands: wait for it, then set each theme until it shows.)
  const themeRead = alice.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/chat/theme', { timeout: 60000 });
  await room(alice);
  await themeRead;
  const seen = new Set();
  for (const theme of ['dark', 'light', 'blade-runner', 'terminal']) {
    for (let shown = 0, tries = 0; shown < 3; tries++) {
      assert.ok(tries < 100, `the ${theme} theme shows`);
      shown = await alice.evaluate(theme => {
        const on = () => [...document.querySelectorAll('article[id^="chat-message-"]')].find(a => a.checkVisibility())?.closest('[data-theme]').dataset.theme === theme;
        if (!on()) window.dispatchEvent(new StorageEvent('storage', { key: 'longboard-public-chat-theme-v1', newValue: theme }));
        return on();
      }, theme) ? shown + 1 : 0;
      await new Promise(r => setTimeout(r, 150));
    }
    v = await open(alice, `article button[title="${label('Mallory')}"]`, 'Mallory');
    const colors = await alice.evaluate(VIEW => {
      const d = document.querySelector(VIEW), probe = document.createElement('i');
      probe.style.cssText = 'background:var(--chat-panel);color:var(--chat-text)';
      d.parentElement.append(probe);
      const want = getComputedStyle(probe), got = getComputedStyle(d), out = { theme: d.parentElement.dataset.theme, panel: want.backgroundColor, text: want.color, background: got.backgroundImage === 'none' ? got.backgroundColor : got.backgroundImage, color: getComputedStyle(d.querySelector('h2')).color };
      probe.remove();
      return out;
    }, VIEW);
    assert.equal(colors.theme, theme);
    // Terminal draws its thin gradient edge on every dialog: the panel colour is the layer over it.
    assert.ok(colors.background === colors.panel || colors.background.startsWith(`linear-gradient(${colors.panel}, ${colors.panel})`), `${theme}: ${colors.background} is not ${colors.panel}`);
    assert.equal(colors.color, colors.text);
    seen.add(colors.background);
    await shot(alice, `theme-${theme}`);
    await escape(alice);
  }
  assert.ok(seen.size >= 3, `the themes look different: ${[...seen].join(' | ')}`);

  // ---- A phone: it fits the screen, the picture is the 256px file at its own size, a tap outside closes it ----
  const bob = await login('bob@example.test', 390, 844);
  // A phone opens on the list of rooms: into the room first.
  await hydrated(bob, 'a[href="/chat?room=main"]');
  await (await visible(bob, 'a[href="/chat?room=main"]')).tap();
  await visible(bob, `article button[aria-label="${label('Alice')}"]`, 'Good morning, Longboard!');
  await settled(bob);
  await shot(bob, 'before-phone');
  await (await visible(bob, `article button[aria-label="${label('Alice')}"]`, 'Good morning, Longboard!')).tap();
  await bob.waitForSelector(VIEW, { timeout: 30000 });
  await bob.waitForFunction(VIEW => document.querySelector(`${VIEW} img`)?.naturalWidth > 0, { timeout: 30000 }, VIEW);
  v = await view(bob);
  assert.equal(v.kind, 'picture');
  assert.equal(v.natural, 256);
  assert.ok(v.width >= 240 && v.width <= 256 && Math.abs(v.width - v.height) < 1, `${v.width} x ${v.height}`);
  assert.ok(v.inside, 'the view fits the phone screen');
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const closeBox = await (await bob.$(`${VIEW} button[aria-label="Close"]`)).boundingBox();
  assert.ok(closeBox.width >= 44 && closeBox.height >= 44, 'the X is big enough to tap');
  // Alice is someone else to Bob: he can message her from here.
  assert.deepEqual(v.buttons, ['Close', 'Message privately']);
  await shot(bob, 'picture-phone');
  await bob.touchscreen.tap(195, 40);
  await closed(bob);
  await (await visible(bob, `article button[title="${label('Mallory')}"]`, 'Mallory')).tap();
  await bob.waitForSelector(VIEW);
  v = await view(bob);
  assert.equal(v.kind, 'initials');
  assert.ok(v.inside);
  await shot(bob, 'initials-phone');
  await (await bob.$(`${VIEW} button[aria-label="Close"]`)).tap();
  await closed(bob);
  // A phone on its side: still inside the screen, with the name in view.
  await bob.setViewport({ width: 667, height: 375, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await (await visible(bob, `article button[title="${label('Mallory')}"]`, 'Mallory')).tap();
  await bob.waitForSelector(VIEW);
  v = await view(bob);
  assert.ok(v.inside, 'the view fits a phone on its side');
  assert.ok(await bob.$eval(`${VIEW} h2`, h => { const r = h.getBoundingClientRect(), d = h.closest('dialog').getBoundingClientRect(); return r.top >= d.top && r.bottom <= d.bottom; }), 'the name is in view');
  await shot(bob, 'initials-phone-sideways');
  await bob.touchscreen.tap(20, 20);
  await closed(bob);

  // ---- An @tag: another member's tag opens the view, picture included; your own still opens your profile ----
  // (The fixture cannot answer the lookup that says which @names are members, so this test answers
  // it with the same rows in the route's own shape; the route itself is covered in chatMentionsResolveRoute.test.ts.)
  const rows = await (await fetch(`${fixture}/rest/v1/longboard_chat_members?select=id,display_name,avatar_path`, { headers: { authorization: 'Bearer test-service-role' } })).json();
  const tagged = rows.filter(m => ['Alice', 'Bob'].includes(m.display_name)).map(m => m.avatar_path ? m : { id: m.id, display_name: m.display_name });
  assert.equal(tagged.find(m => m.display_name === 'Alice').avatar_path, picture);
  await bob.setRequestInterception(true);
  bob.on('request', r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/chat/mentions' ? r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ members: tagged }) }) : r.continue());
  // Alice posts it: the fixture's 80 history messages are Bob's, so he is over the send limit (30 in ten minutes).
  const sent = await alice.evaluate(async () => (await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', room: 'main', body: 'A note for @Alice and @Bob', clientId: crypto.randomUUID() }) })).status);
  assert.equal(sent, 200);
  await bob.setViewport({ width: 1280, height: 900 });
  await bob.goto(`${base}/chat?room=main`);
  await hydrated(bob, `button[data-member-tag][title="${label('Alice')}"]`);
  assert.equal(await bob.$$eval('button[data-member-tag][title="Your profile"]', tags => tags.some(t => t.textContent === '@Bob')), true);
  await settled(bob);
  v = await open(bob, `button[data-member-tag][title="${label('Alice')}"]`);
  assert.equal(v.name, 'Alice');
  assert.equal(v.kind, 'picture');
  assert.ok(v.src.endsWith(`${picture}-256.webp`), v.src);
  assert.deepEqual(v.buttons, ['Close', 'Message privately']);
  await escape(bob);
  assert.equal(await bob.$(DM), null, 'a tag alone no longer opens a private message');

  assert.deepEqual(errors, []);
  console.log('PASS the larger picture view: from a picture and a name in a room, a thread, a DM, the Member List and search; the 256px file sharp; initials for no picture; X, outside click and Escape (thread and Member List stay open); focus in and back; keyboard; Message privately; an @tag; four themes; a phone upright and on its side.');
} finally {
  await browser.close();
}
