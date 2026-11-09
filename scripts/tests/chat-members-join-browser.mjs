// #384 Booker Stock Club: Stripe -> members tables -> chat access, against the fixture on this
// test's own ports (localhost:3384, database 127.0.0.1:54384). Synthetic people, events and keys
// only; Stripe and Resend are answered by chat-members-join-preload.mjs (nothing leaves the
// machine). The Stripe events are signed here with stripe.webhooks.generateTestHeaderString.
//  - the webhook refuses unsigned and wrongly signed deliveries, and a resend does nothing;
//  - the thank-you link (/join/club?session_id=...) says "We're confirming your purchase…" until the
//    checkout event arrives, then offers the purchase email; the emailed code signs in, the buyer
//    picks a chat name and lands in the Gainers room: Gainers and Gainers Table, nothing else;
//  - a wrong code is refused; a Longboard member's email is sent to the Longboard sign-in;
//  - canceling the subscription ends the access at once;
//  - the admin page: signed out and non-admins are refused; an admin sees the buyer's purchase and
//    access, grants an entitlement by hand and revokes one.
// CHAT_SHOT_DIR saves t384-join.png (confirming), t384-join-code.png and t384-admin.png.
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import Stripe from 'stripe';
import { signIn } from './browser-login.mjs';
const base = process.env.CHAT_TEST_URL || 'http://localhost:3384', fixture = process.env.CHAT_FIXTURE_URL || 'http://127.0.0.1:54384';
for (const url of [base, fixture]) assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const shots = process.env.CHAT_SHOT_DIR, SECRET = 'whsec_synthetic_members_test_secret_never_real';
const outbox = join(tmpdir(), `chat-members-outbox-${new URL(base).port}.jsonl`);
rmSync(outbox, { force: true });
const control = async (path, body = {}) => { const r = await fetch(fixture + '/test/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), text = await r.text(); assert.equal(r.status, 200, text); return JSON.parse(text); };
const sql = (text, args = []) => control('sql', { sql: text, args });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
let seq = 0;
const event = (type, object) => ({ id: `evt_test_members_${++seq}`, object: 'event', type, created: now() + seq, livemode: false, api_version: '2026-09-30.endive', data: { object } });
const deliver = async (payload, { secret = SECRET, sign = true } = {}) => {
  const body = JSON.stringify(payload);
  const headers = { 'content-type': 'application/json' };
  if (sign) headers['stripe-signature'] = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  const r = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers, body });
  return { status: r.status, body: await r.json() };
};
const lastCode = to => {
  const mails = readFileSync(outbox, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(m => m.to.includes(to));
  assert(mails.length, `an email went to ${to}`);
  const code = mails.at(-1).text.match(/\b(\d{6})\b/)?.[1];
  assert(code, 'the email has a six-digit code');
  assert.match(mails.at(-1).subject, /Booker Stock Club/);
  return code;
};
const visibleText = page => page.evaluate(() => document.body.innerText);

// The club's Stripe price -> our product, the way it's set up after merge.
await sql(`insert into member_product_stripe_ids(stripe_id,product_key) values('price_clubtest1','booker-stock-club')`);
const SESSION = 'cs_test_a1Bea2Buyer3Club4Members5';
const checkout = {
  id: SESSION, object: 'checkout.session', mode: 'subscription', payment_status: 'paid', status: 'complete',
  amount_total: 2900, currency: 'usd', customer: 'cus_test_bea', subscription: 'sub_test_bea',
  customer_details: { email: 'Bea@Example.test', name: 'Bea Buyer' }, metadata: {},
};

const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const desktop = { width: 1280, height: 860 };
try {
  // 1. The webhook only takes Stripe's signature.
  assert.equal((await deliver(event('checkout.session.completed', checkout), { sign: false })).status, 400, 'unsigned');
  assert.equal((await deliver(event('checkout.session.completed', checkout), { secret: 'whsec_wrong' })).status, 400, 'wrong secret');
  assert.equal((await sql(`select count(*)::int n from member_people`))[0].n, 0, 'nothing was written');

  // 2. The thank-you button lands before Stripe's event: "confirming".
  const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport(desktop);
  await page.goto(`${base}/join/club?session_id=${SESSION}`);
  await page.waitForSelector('[data-join-step="confirming"]', { timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes('We’re confirming your purchase…'), { timeout: 30000 });
  if (shots) { await sleep(300); await page.screenshot({ path: `${shots}/t384-join.png` }); }
  await sleep(3000);
  assert.equal(await page.$eval('[data-join-step]', e => e.dataset.joinStep), 'confirming', 'still confirming while the event is on its way');

  // 3. Stripe's event arrives (once, then again): the page moves on with the purchase email.
  const paid = event('checkout.session.completed', checkout);
  assert.deepEqual((await deliver(paid)).body, { received: true, status: 'processed', outcome: 'granted:active' });
  assert.deepEqual((await deliver(paid)).body, { received: true, status: 'duplicate', outcome: 'already_processed' });
  const [person] = await sql(`select id,email,name,stripe_customer_id,chat_account_id from member_people`);
  assert.deepEqual({ ...person, id: undefined }, { id: undefined, email: 'bea@example.test', name: 'Bea Buyer', stripe_customer_id: 'cus_test_bea', chat_account_id: null });
  const purchases = await sql(`select product_key,kind,status,stripe_price_id,current_period_end>now()+interval '28 days' renews from member_purchases`);
  assert.deepEqual(purchases, [{ product_key: 'booker-stock-club', kind: 'subscription', status: 'active', stripe_price_id: 'price_clubtest1', renews: true }], 'line items and the subscription were read from (fake) Stripe');
  assert.deepEqual((await sql(`select entitlement_key k from member_entitlements order by 1`)).map(r => r.k), ['club-room', 'gainers', 'reader']);
  await page.waitForSelector('[data-join-step="email"]', { timeout: 20000 });
  assert.equal(await page.$eval('#join-email', e => e.value), 'bea@example.test', 'the purchase email is filled in');

  // 4. The code: a wrong one is refused, the emailed one signs in.
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-join-step="code"]', { timeout: 20000 });
  const code = lastCode('bea@example.test');
  await page.type('#join-code', code === '000000' ? '111111' : '000000');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]', { timeout: 20000 });
  assert.match(await page.$eval('[role="alert"]', e => e.textContent), /isn.t right/);
  await page.click('#join-code', { clickCount: 3 }); await page.keyboard.press('Backspace');
  await page.type('#join-code', code);
  if (shots) await page.screenshot({ path: `${shots}/t384-join-code.png` });
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-join-step="name"]', { timeout: 20000 });
  const [linked] = await sql(`select chat_account_id from member_people where email='bea@example.test'`);
  assert(linked.chat_account_id, 'the person is linked to the new chat account');
  await page.type('#join-name', 'Bea Buyer');
  await Promise.all([page.waitForNavigation({ timeout: 90000 }), page.click('button[type="submit"]')]);
  assert.match(page.url(), /\/chat\?room=gainers$/, page.url());
  await page.waitForFunction(() => [...document.querySelectorAll('#chat-room-navigation')].some(e => e.checkVisibility()), { timeout: 90000 });
  await page.waitForSelector('a[data-chat-gainers-table]', { visible: true, timeout: 60000 });
  // Open rows (not the locked ones every member sees for rooms they don't have).
  const open = await page.evaluate(() => { const nav = [...document.querySelectorAll('#chat-room-navigation')].find(e => e.checkVisibility()); return [...nav.querySelectorAll('a:not([data-locked])')].filter(a => a.checkVisibility()).map(a => (a.querySelector('[data-initials]')?.nextElementSibling?.firstChild?.textContent ?? a.textContent).trim()); });
  // #386: the club's buyers (club-room and gainers entitlements) also have the Booker Stock Club room.
  assert.deepEqual(open.filter(n => n !== 'Features'), ['Gainers', 'Gainers Table', 'News Feed', 'Booker Stock Club'], open.join(' | '));
  await (await page.$('a[data-chat-gainers-table]')).click();
  await page.waitForSelector('[data-gainers-table]', { visible: true, timeout: 30000 });
  const status = path => page.evaluate(async p => (await fetch(p)).status, path);
  assert.equal(await status('/api/chat/gainers/table'), 200, 'the Gainers Table opens');
  assert.equal(await status('/api/chat/history?room=gainers'), 200, 'the Gainers room reads');
  assert.equal(await status('/api/chat/history?room=social'), 403, 'Social does not');
  assert.equal((await sql(`select display_name from longboard_chat_members where user_id=$1`, [linked.chat_account_id]))[0].display_name, 'Bea Buyer');
  // Going back to the join page when signed in goes straight to the room.
  await page.goto(`${base}/join/club`);
  assert.match(page.url(), /\/chat\?room=gainers$/);

  // 5. Canceling the subscription ends it straight away.
  const deleted = event('customer.subscription.deleted', { id: 'sub_test_bea', object: 'subscription', customer: 'cus_test_bea', status: 'canceled', items: { data: [{ current_period_end: now() + 20 * 86400, price: { id: 'price_clubtest1', product: 'prod_clubtest1' } }] } });
  assert.equal((await deliver(deleted)).body.outcome, 'revoked:subscription_canceled');
  assert.equal(await status('/api/chat/gainers/table'), 401, 'no active entitlement: signed out of the club');
  await context.close();

  // 6. A Longboard member's email is sent to the Longboard sign-in instead.
  await deliver(event('checkout.session.completed', { ...checkout, id: 'cs_test_m2Mallory3Club4Members5', subscription: 'sub_test_mal', customer: 'cus_test_mal', customer_details: { email: 'mallory@example.test' } }));
  {
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
    await p.goto(`${base}/join/club`);
    await p.waitForSelector('#join-email', { timeout: 60000 });
    await p.type('#join-email', 'mallory@example.test');
    await p.click('button[type="submit"]');
    await p.waitForSelector('[data-join-step="longboard"]', { timeout: 20000 });
    assert.match(await visibleText(p), /already have a Longboard account/);
    await ctx.close();
  }

  // 7. Admin page: signed out and non-admins are refused.
  assert.equal((await fetch(`${base}/api/admin/members`)).status, 401, 'signed out');
  {
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
    await signIn(p, base, 'bob@example.test');
    assert.equal(await p.evaluate(async () => (await fetch('/api/admin/members')).status), 403, 'a member is not an admin');
    await p.goto(`${base}/admin/members`);
    assert(!p.url().includes('/admin/members'), `a member is sent away: ${p.url()}`);
    await ctx.close();
  }
  // This fixture keeps Alice an ordinary member; make her the admin here.
  await sql(`update profiles set role='admin' where email='alice@example.test'`);
  {
    const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
    await p.setViewport(desktop);
    await signIn(p, base, 'alice@example.test');
    await p.goto(`${base}/admin/members`);
    await p.waitForSelector('[data-member="bea@example.test"]', { timeout: 90000 });
    const bea = await p.$eval('[data-member="bea@example.test"]', e => e.innerText);
    assert.match(bea, /booker-stock-club/); assert.match(bea, /canceled/); assert.match(bea, /chat linked/); assert.match(bea, /revoked \(subscription_canceled\)/);
    // Grant Bea the Reader by hand.
    await p.type('input[aria-label="Email to grant"]', 'bea@example.test');
    await p.select('select[aria-label="Entitlement"]', 'reader');
    await p.type('input[aria-label="Note"]', 'comp while we sort the card');
    await p.click('form button[type="submit"]');
    await p.waitForFunction(() => document.querySelector('[data-member="bea@example.test"]')?.innerText.includes('admin · comp'), { timeout: 20000 });
    assert.deepEqual((await sql(`select e.entitlement_key k,e.granted_by g from member_entitlements e join member_people p on p.id=e.person_id where p.email='bea@example.test' and e.revoked_at is null`)), [{ k: 'reader', g: 'admin' }]);
    // Search by email.
    await p.type('input[aria-label="Search by email"]', 'mallory');
    await p.waitForFunction(() => document.querySelectorAll('[data-member]').length === 1 && document.querySelector('[data-member="mallory@example.test"]'), { timeout: 20000 });
    await p.click('input[aria-label="Search by email"]', { clickCount: 3 }); await p.keyboard.press('Backspace');
    await p.waitForFunction(() => document.querySelectorAll('[data-member]').length === 2, { timeout: 20000 });
    if (shots) { await sleep(300); await p.screenshot({ path: `${shots}/t384-admin.png`, fullPage: true }); }
    // Revoke Mallory's gainers.
    p.on('dialog', d => d.accept());
    await p.click('[data-member="mallory@example.test"] [data-entitlement="gainers"] button');
    await p.waitForFunction(() => document.querySelector('[data-member="mallory@example.test"] [data-entitlement="gainers"]')?.innerText.includes('revoked (admin)'), { timeout: 20000 });
    assert.deepEqual(await sql(`select revoked_by from member_entitlements e join member_people p on p.id=e.person_id where p.email='mallory@example.test' and e.entitlement_key='gainers'`), [{ revoked_by: 'admin' }]);
    await ctx.close();
  }
  assert.deepEqual(errors, [], 'no page errors');
  console.log('chat-members-join: ok');
} finally {
  await browser.close();
  rmSync(outbox, { force: true });
}
