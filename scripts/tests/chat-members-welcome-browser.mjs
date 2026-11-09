// #390 Booker Stock Club welcome email and one-tap sign-in, against the fixture on this test's own
// ports (localhost:3490, database 127.0.0.1:54490). Synthetic people, events and keys only; Stripe
// and Resend are answered by chat-members-join-preload.mjs (nothing leaves the machine; emails go
// to an outbox file). The Stripe events are signed here with stripe.webhooks.generateTestHeaderString.
//  - a signed $1 lifetime purchase sends exactly one "Welcome to the Booker Stock Club" email with
//    one button to https://chat.robbooker.com/join/club/welcome?t=...; a resend of the event sends none;
//  - opening the link doesn't use it; its "Open the club chat" button signs in, the chat name is
//    filled in from Stripe, and the buyer lands in the Gainers room;
//  - the same link again says it was used and "Email me a new link" sends a fresh one;
//  - the thank-you page (/join/club?session_id=...) waits for the purchase, then signs a second
//    buyer in with one tap and nothing typed; the same session later only offers the code sign-in;
//  - the Members admin page shows the welcome as sent and "Resend welcome" sends another.
// CHAT_SHOT_DIR saves t390-email.png (the welcome email's HTML) and t390-welcome.png (the link's page).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import Stripe from 'stripe';
import { signIn } from './browser-login.mjs';
const base = process.env.CHAT_TEST_URL || 'http://localhost:3490', fixture = process.env.CHAT_FIXTURE_URL || 'http://127.0.0.1:54490';
for (const url of [base, fixture]) assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const shots = process.env.CHAT_SHOT_DIR, SECRET = 'whsec_synthetic_members_test_secret_never_real';
const outbox = join(tmpdir(), `chat-members-outbox-${new URL(base).port}.jsonl`);
rmSync(outbox, { force: true });
const control = async (path, body = {}) => { const r = await fetch(fixture + '/test/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), text = await r.text(); assert.equal(r.status, 200, text); return JSON.parse(text); };
const sql = (text, args = []) => control('sql', { sql: text, args });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
let seq = 0;
const event = (type, object) => ({ id: `evt_test_welcome_${++seq}`, object: 'event', type, created: now() + seq, livemode: false, api_version: '2026-09-30.endive', data: { object } });
const deliver = async payload => {
  const body = JSON.stringify(payload);
  const r = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) }, body });
  return { status: r.status, body: await r.json() };
};
const mails = to => (existsSync(outbox) ? readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []).filter(m => m.to.includes(to));
const welcomeLink = mail => {
  const link = mail.text.match(/https:\/\/chat\.robbooker\.com\/join\/club\/welcome\?t=[A-Za-z0-9_-]{43}/)?.[0];
  assert(link, 'the welcome has a one-tap link to the club chat');
  // The same path on this test's server.
  return base + new URL(link).pathname + new URL(link).search;
};
const step = (page, value) => page.waitForSelector(`[data-welcome-state="${value}"]`, { timeout: 90000 });
const hydrated = page => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => Object.keys(b).some(k => k.startsWith('__reactProps'))), { timeout: 90000 });
const clickText = (page, text) => page.evaluate(t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t)?.click(), text);
const pickNameAndGo = async page => {
  await page.waitForSelector('#join-name', { timeout: 20000 });
  const prefilled = await page.$eval('#join-name', e => e.value);
  await Promise.all([page.waitForNavigation({ timeout: 90000 }), page.click('button[type="submit"]')]);
  assert.match(page.url(), /\/chat\?room=gainers$/, page.url());
  const status = await page.evaluate(async () => (await fetch('/api/chat/gainers/table')).status);
  assert.equal(status, 200, 'the Gainers Table opens');
  return prefilled;
};

await sql(`insert into member_product_stripe_ids(stripe_id,product_key) values('price_clubtest1','booker-stock-club')`);
// Rob's real test: a $1 one-time purchase with lifetime access.
const purchase = (id, email, name, pi) => ({
  id, object: 'checkout.session', mode: 'payment', payment_status: 'paid', status: 'complete', amount_total: 100, currency: 'usd',
  customer: null, payment_intent: pi, customer_details: { email, name }, metadata: {},
});

const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const desktop = { width: 1280, height: 860 };
const errors = [];
const fresh = async () => {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport(desktop);
  return { context, page };
};
try {
  // 1. The purchase sends one welcome, once.
  const paid = event('checkout.session.completed', purchase('cs_test_d1Dee2Welcome3Club4', 'Dee@Example.test', 'Dee Buyer', 'pi_test_dee'));
  assert.deepEqual((await deliver(paid)).body, { received: true, status: 'processed', outcome: 'granted:paid' });
  assert.deepEqual((await deliver(paid)).body, { received: true, status: 'duplicate', outcome: 'already_processed' });
  assert.equal(mails('dee@example.test').length, 1, 'exactly one welcome');
  const [welcome] = mails('dee@example.test');
  assert.equal(welcome.subject, 'Welcome to the Booker Stock Club');
  assert.equal(welcome.from, 'Booker Stock Club <club@example.test>');
  assert.equal((welcome.html.match(/>Open the club chat<\/a>/g) ?? []).length, 1, 'one button');
  assert.deepEqual(await sql(`select welcome_status s,welcome_kind k,welcome_attempts a from member_people where email='dee@example.test'`), [{ s: 'sent', k: 'club', a: 1 }]);
  const tokens = await sql(`select token_hash,purpose,consumed_at from member_welcome_tokens`);
  assert.equal(tokens.length, 1);
  assert(!welcome.text.includes(tokens[0].token_hash), 'only the hash is stored');
  const link = welcomeLink(welcome);
  if (shots) {
    const { context, page } = await fresh();
    await page.setViewport({ width: 720, height: 760 });
    await page.setContent(welcome.html, { waitUntil: 'load' });
    await page.screenshot({ path: `${shots}/t390-email.png`, fullPage: true });
    await context.close();
  }

  // 2. Opening the link (as a mail scanner would) leaves it unused; the button signs in.
  {
    const scanner = await fetch(link);
    assert.equal(scanner.status, 200);
    const { context, page } = await fresh();
    await page.goto(link);
    await step(page, 'ready');
    assert.match(await page.evaluate(() => document.body.innerText), /the News Feed, the Reader and the Booker Stock Club room/);
    assert.equal((await sql(`select count(*)::int n from member_welcome_tokens where consumed_at is not null`))[0].n, 0, 'opening never uses it');
    await hydrated(page);
    if (shots) { await sleep(300); await page.screenshot({ path: `${shots}/t390-welcome.png` }); }
    await clickText(page, 'Open the club chat');
    await step(page, 'name');
    assert.equal(await pickNameAndGo(page), 'Dee Buyer', 'the chat name comes from Stripe');
    const [dee] = await sql(`select p.chat_account_id,m.display_name from member_people p left join longboard_chat_members m on m.user_id=p.chat_account_id where p.email='dee@example.test'`);
    assert(dee.chat_account_id, 'linked to a new chat account');
    assert.equal(dee.display_name, 'Dee Buyer');
    await context.close();
  }

  // 3. The same link again: used; "Email me a new link" sends a fresh one.
  {
    const { context, page } = await fresh();
    await page.goto(link);
    await step(page, 'used');
    assert.match(await page.evaluate(() => document.body.innerText), /already used/);
    assert(await page.$('a[href="/join/club"]'), 'the code sign-in is offered');
    await hydrated(page);
    await clickText(page, 'Email me a new link');
    await step(page, 'sent');
    assert.equal(mails('dee@example.test').length, 2, 'a new link went to the purchase email');
    assert.notEqual(welcomeLink(mails('dee@example.test')[1]), link);
    await context.close();
  }

  // 4. The thank-you page: lands before Stripe's event, then one tap with nothing typed.
  const EVE = 'cs_test_e1Eve2Thanks3Club4Welcome';
  {
    const { context, page } = await fresh();
    await page.goto(`${base}/join/club?session_id=${EVE}`);
    await page.waitForSelector('[data-join-step="confirming"]', { timeout: 90000 });
    await sleep(1500);
    assert.equal((await deliver(event('checkout.session.completed', purchase(EVE, 'eve@example.test', 'Eve Early', 'pi_test_eve')))).body.outcome, 'granted:paid');
    await page.waitForSelector('[data-join-step="onetap"]', { timeout: 30000 });
    assert.equal(await page.$('#join-email'), null, 'no email to type');
    await clickText(page, 'Open the club chat');
    await page.waitForSelector('[data-join-step="name"]', { timeout: 20000 });
    assert.equal(await pickNameAndGo(page), 'Eve Early');
    assert.equal((await sql(`select count(*)::int n from member_welcome_tokens where checkout_session_id=$1 and consumed_at is not null`, [EVE]))[0].n, 1);
    await context.close();
  }
  // The same session in another browser: no second one-tap sign-in, the code sign-in instead.
  {
    const { context, page } = await fresh();
    await page.goto(`${base}/join/club?session_id=${EVE}`);
    await page.waitForSelector('[data-join-step="email"]', { timeout: 90000 });
    assert.equal(await page.$eval('#join-email', e => e.value), 'eve@example.test');
    const tries = await page.evaluate(async s => (await fetch('/api/members/join/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: s }) })).status, EVE);
    assert.equal(tries, 409, 'the session already signed in');
    await context.close();
  }

  // 5. The Members admin page shows the welcome and resends it.
  await sql(`update profiles set role='admin' where email='alice@example.test'`);
  {
    const { context, page } = await fresh();
    await signIn(page, base, 'alice@example.test');
    await page.goto(`${base}/admin/members`);
    await page.waitForSelector('[data-member="dee@example.test"] [data-welcome="sent"]', { timeout: 90000 });
    assert.match(await page.$eval('[data-member="dee@example.test"] [data-welcome]', e => e.textContent), /welcome sent/);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => [...document.querySelectorAll('[data-member="dee@example.test"] button')].find(b => b.textContent.includes('Resend welcome')).click());
    for (let i = 0; i < 100 && mails('dee@example.test').length < 3; i++) await sleep(200);
    assert.equal(mails('dee@example.test').length, 3, 'the admin resend went out');
    assert.deepEqual(await sql(`select welcome_status s,welcome_attempts a from member_people where email='dee@example.test'`), [{ s: 'sent', a: 2 }]);
    await context.close();
  }
  assert.deepEqual(errors, [], 'no page errors');
  console.log('chat-members-welcome: ok');
} finally {
  await browser.close();
  rmSync(outbox, { force: true });
}
