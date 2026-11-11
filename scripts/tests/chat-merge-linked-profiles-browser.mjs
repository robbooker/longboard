// #444 one chat profile per person, end to end on synthetic accounts. Run with
// chat-merge-linked-profiles-fixture.mjs. Bob's Longboard account is linked to the fixture's
// ShortScout account, whose profile is "Bob Smith" and posted in Social. Before the merge the @ list
// shows him twice; after chat_merge_next_linked_profile() it shows him once, his old message shows
// under the kept profile (Bob), and a tag typed as the old name is plain text.
// --before: only the seeding and the screenshot of today's @ list (for the look-first pages).
// CHAT_SHOT_DIR: also saves before-/after-at-menu.png and before-/after-old-message.png there.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { signIn } from './browser-login.mjs';
const base = process.env.CHAT_TEST_URL || 'http://localhost:3444';
const fixture = process.env.CHAT_FIXTURE_URL || 'http://127.0.0.1:54644';
const shots = process.env.CHAT_SHOT_DIR;
const before = process.argv.includes('--before');
const phase = before ? 'before' : 'after';
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];
const sql = async (query, args = []) => {
  const r = await fetch(`${fixture}/test/sql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: query, args }) });
  if (!r.ok) throw Error(await r.text());
  return r.json();
};
const article = id => `article[id="chat-message-${id}"]`;
const LIST = '[role="listbox"][aria-label="Mention a member"]';
const options = page => page.$$eval(`${LIST} [role="option"]`, list => list.map(o => o.textContent.trim()));
const shot = async (page, name, selector) => {
  if (!shots) return;
  const box = await page.$eval(selector, e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  const pad = 24, clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(1280, box.width + pad * 2), height: box.height + pad * 2 };
  await page.screenshot({ path: `${shots}/${phase}-${name}.png`, clip });
};
async function typeTag(page, text) {
  const box = 'textarea[aria-label^="Message "]';
  await page.click(box, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(box, text);
  await page.waitForResponse(r => r.url().includes('/api/chat/mentions?q='), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 400));
}

try {
  const { people } = await (await fetch(`${fixture}/test/identity`)).json();
  const bob = people[1];
  const scoutAccount = '00000000-0000-4000-8000-000000000099';
  const [scout] = await sql('select id from longboard_chat_members where user_id=$1', [scoutAccount]);
  // ---- Seeded the way production has it: one person, two linked profiles ----
  await sql("update longboard_chat_members set display_name='Bob Smith' where id=$1", [scout.id]);
  await sql('insert into chat_accounts(id,longboard_user_id) values($1,$1) on conflict do nothing', [bob.id]);
  await sql('insert into chat_shortscout_membership_links(lb_account_id,source_account_id,subject) values($1,$2,$2)', [bob.id, scoutAccount]);
  const [old] = await sql("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob Smith','Posted from my ShortScout profile last week','social') returning id", [scout.id]);

  if (!before) {
    const [{ r: merged }] = await sql('select chat_merge_next_linked_profile() r');
    assert.equal(merged.mode, 'merge', JSON.stringify(merged));
    assert.deepEqual([merged.kept, merged.retired], ['Bob', 'Bob Smith']);
  }

  const context = await browser.createBrowserContext(), page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await signIn(page, base, 'alice@example.test');
  await page.goto(`${base}/chat?room=social`);
  await page.waitForSelector(article(old.id), { visible: true, timeout: 60000 });

  // ---- The old message shows under the kept profile ----
  await page.$eval(article(old.id), e => e.scrollIntoView({ block: 'center' }));
  const text = await page.$eval(article(old.id), a => a.textContent);
  if (before) assert.ok(text.includes('Bob Smith'));
  else assert.ok(text.includes('Bob') && !text.includes('Bob Smith'), text);
  await shot(page, 'old-message', article(old.id));

  // ---- The @ list ----
  await typeTag(page, 'Hi @Bo');
  const list = await options(page);
  if (before) assert.deepEqual(list.map(o => o.replace(/Member.*$/, '')), ['@Bob', '@Bob Smith'], 'before: the same person twice');
  else assert.deepEqual(list.map(o => o.replace(/Member.*$/, '')), ['@Bob'], 'after: once');
  await shot(page, 'at-menu', LIST);

  if (!before) {
    // The old name finds him too, shown under his current name.
    await typeTag(page, 'Hi @Bob S');
    assert.deepEqual((await options(page)).map(o => o.replace(/Member.*$/, '')), ['@Bob'], 'found by the retired name, once');
  }

  assert.deepEqual(errors, []);
  console.log(before
    ? 'PASS (before) one person, two linked profiles: the @ list shows him twice.'
    : 'PASS one profile per person: after the merge the @ list shows him once (by either name) and his old ShortScout message shows under the kept profile.');
} finally {
  await browser.close();
}
