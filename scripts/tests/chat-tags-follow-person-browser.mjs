// #439 @tags follow the person through a name change, end to end on synthetic accounts. Run with
// chat-tags-follow-person-fixture.mjs, which holds the migration back: the test seeds a tag the way
// production has it (only "@Bob" in the text), Bob renames himself to Robert Bobson, then the
// migration and its batched backfill run. Covers: the old tag showing the new name and opening
// Robert's view; the @ list finding him once (by his new name and by his old one, "was Bob"); his
// mention still listed for him, also after the old message is edited; a new tag notifying him.
// --before: only the seeding and the screenshots of today's behavior (for the look-first pages).
// CHAT_SHOT_DIR: also saves before-/after-at-menu.png and before-/after-old-tag.png there.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { signIn } from './browser-login.mjs';
const base = process.env.CHAT_TEST_URL || 'http://localhost:3439';
const fixture = process.env.CHAT_FIXTURE_URL || 'http://127.0.0.1:54639';
const shots = process.env.CHAT_SHOT_DIR;
const before = process.argv.includes('--before');
const phase = before ? 'before' : 'after';
const MIGRATION = '20261111120000_chat_tags_follow_person.sql';
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];
const post = (path, body) => fetch(`${fixture}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const sql = async (query, args = []) => { const r = await post('/test/sql', { sql: query, args }); if (!r.ok) throw Error(await r.text()); return r.json(); };
const VIEW = 'dialog[data-member-picture-view][open]';
async function login(email) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => errors.push(`${email}: ${e.message}`));
  await signIn(page, base, email);
  return page;
}
const api = (page, path, body) => page.evaluate(async (path, body) => {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  return { status: r.status, body: await r.json().catch(() => null) };
}, path, body);
const hydrated = (page, selector) => page.waitForFunction(s => [...document.querySelectorAll(s)].some(e => e.checkVisibility() && Object.keys(e).some(k => k.startsWith('__reactProps$'))), { timeout: 60000 }, selector);
const article = id => `article[id="chat-message-${id}"]`;
const shot = async (page, name, selector) => {
  if (!shots) return;
  const box = await page.$eval(selector, e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  const pad = 24, clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(1280, box.width + pad * 2), height: box.height + pad * 2 };
  await page.screenshot({ path: `${shots}/${phase}-${name}.png`, clip });
};
const options = page => page.$$eval('[role="listbox"][aria-label="Mention a member"] [role="option"]', list => list.map(o => o.textContent.trim()));
async function typeTag(page, text) {
  const box = 'textarea[aria-label^="Message "]';
  await page.click(box, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(box, text);
  // The list asks after a 200 ms pause; give it the answer or a settled "nothing".
  await page.waitForResponse(r => r.url().includes('/api/chat/mentions?q='), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 400));
}

try {
  const { people } = await (await fetch(`${fixture}/test/identity`)).json();
  const [alice, bob] = people;
  const bobMember = bob.member.id;
  // ---- Seeded the way production has it: Alice tagged Bob, then Bob changed his name ----
  const [oldTag] = await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Alice','@Bob can you share your notes from this morning?','social') returning id", [alice.member.id]);
  const bobPage = await login('bob@example.test');
  const renamed = await api(bobPage, '/api/chat/member', { action: 'rename', displayName: 'Robert Bobson' });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.member.display_name, 'Robert Bobson');
  const mentioned = async () => JSON.stringify((await api(bobPage, '/api/chat/activity?rooms=social&why=1')).body ?? {});
  assert.ok((await mentioned()).includes(oldTag.id), 'Bob was notified when he was tagged');

  if (!before) {
    // ---- The migration, then its backfill in small batches ----
    await post('/test/exec', { sql: await readFile(new URL(`../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8') }).then(r => assert.ok(r.ok));
    let state;
    do [{ s: state }] = await sql('select chat_tags_backfill_step(25) s'); while (state.phase !== 'done');
    assert.deepEqual(await sql('select tagged_as,member_id from chat_message_tags where message_id=$1', [oldTag.id]), [{ tagged_as: 'Bob', member_id: bobMember }]);
  }

  const page = await login('alice@example.test');
  if (before) {
    // The fixture cannot run the old name lookup (an OR of ILIKEs), so it is answered here the way
    // production answers it: the members whose current name is one of the tagged names.
    await page.setRequestInterception(true);
    page.on('request', async r => {
      if (r.method() !== 'POST' || new URL(r.url()).pathname !== '/api/chat/mentions') return r.continue();
      const names = JSON.parse(r.postData()).names;
      const members = await sql('select id,display_name from longboard_chat_members where lower(display_name)=any($1)', [names]);
      r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ members }) });
    });
  }
  await page.goto(`${base}/chat?room=social`);
  await page.waitForSelector(article(oldTag.id), { visible: true, timeout: 60000 });
  await page.$eval(article(oldTag.id), e => e.scrollIntoView({ block: 'center' }));

  // ---- The old message's tag ----
  if (before) {
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(await page.$(`${article(oldTag.id)} [data-member-tag]`), null, 'before: the old tag is plain text');
  } else {
    const tag = `${article(oldTag.id)} button[data-member-tag="${bobMember}"]`;
    await hydrated(page, tag);
    assert.deepEqual(await page.$eval(tag, b => [b.textContent, b.dataset.taggedAs]), ['@Robert Bobson', '@Bob']);
    assert.ok((await page.$eval(article(oldTag.id), a => a.textContent)).includes('@Robert Bobson can you share your notes from this morning?'));
  }
  await shot(page, 'old-tag', article(oldTag.id));
  if (!before) {
    await page.click(`${article(oldTag.id)} button[data-member-tag="${bobMember}"]`);
    await page.waitForSelector(VIEW, { timeout: 30000 });
    assert.equal(await page.$eval(`${VIEW} h2`, h => h.textContent), 'Robert Bobson', 'the tag opens the right person');
    await page.keyboard.press('Escape');
    await page.waitForFunction(VIEW => !document.querySelector(VIEW), { timeout: 10000 }, VIEW);
  }

  // ---- The @ list ----
  await typeTag(page, 'Thanks @Bo');
  const byOld = await options(page);
  if (before) assert.deepEqual(byOld, [], 'before: his old name finds no one');
  else assert.deepEqual(byOld, ['@Robert BobsonMember · was Bob'], 'found once by his old name, under his new one');
  await shot(page, 'at-menu', byOld.length ? '[role="listbox"][aria-label="Mention a member"]' : 'textarea[aria-label^="Message "]');
  await typeTag(page, 'Thanks @Rob');
  assert.deepEqual(await options(page), ['@Robert BobsonMember'], 'once under his new name');
  await typeTag(page, 'Thanks @');
  const all = await options(page);
  assert.equal(all.filter(o => o.startsWith('@Robert Bobson')).length, 1);
  assert.ok(!all.some(o => o.startsWith('@BobMember')));

  if (!before) {
    // Picking him from the list: the tag is written under his name now and notifies him.
    await typeTag(page, '@Bo');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('textarea[aria-label^="Message "]', t => t.value), '@Robert Bobson ');
    const fresh = await api(page, '/api/chat', { action: 'send', room: 'social', body: '@Robert Bobson welcome back', clientId: crypto.randomUUID() });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    const [freshRow] = await sql("select id from longboard_chat_messages where body='@Robert Bobson welcome back'");
    assert.ok((await mentioned()).includes(freshRow.id), 'a new tag notifies as normal');
    // ---- His earlier mention: still listed for him, also after Alice edits the old message ----
    assert.ok((await mentioned()).includes(oldTag.id));
    const edit = await api(page, '/api/chat/message', { room: 'social', messageId: oldTag.id, action: 'edit', body: '@Bob can you share your notes from this morning, please?', expectedBody: '@Bob can you share your notes from this morning?' });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.ok((await mentioned()).includes(oldTag.id), 'an edit after his rename keeps his mention');
    // The edited text is read fresh: without the realtime service (none in this fixture) an edit by
    // a script reaches an open window only on the next background refresh (30-65 s), which is not
    // what this test is about.
    await page.goto(`${base}/chat?room=social`);
    const tag = `${article(oldTag.id)} button[data-member-tag="${bobMember}"]`;
    await page.waitForSelector(article(oldTag.id), { visible: true, timeout: 60000 });
    await hydrated(page, tag);
    assert.ok((await page.$eval(article(oldTag.id), a => a.textContent)).includes('@Robert Bobson can you share your notes from this morning, please?'));
    assert.deepEqual(await page.$eval(tag, b => [b.textContent, b.dataset.taggedAs]), ['@Robert Bobson', '@Bob']);
  }

  assert.deepEqual(errors, []);
  console.log(before
    ? 'PASS (before) seeded an old tag and a rename; saved today\'s old tag and @ list.'
    : 'PASS tags follow the person: an old tag shows the new name and opens the right person; the @ list finds him once, by the new name and the old; his mention stays listed after an edit; a new tag notifies.');
} finally {
  await browser.close();
}
