// #384: the club sign-up browser test's fake Resend and fake Stripe, loaded into the Next server.
// No email is sent and no Stripe request leaves this machine: Resend calls are written to an
// outbox file the test reads (the sign-in code), and the few Stripe reads the webhook makes are
// answered from the synthetic objects below. Every other Stripe address is refused.
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const port = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3384').port;
const outbox = join(tmpdir(), `chat-members-outbox-${port}.jsonl`);
const day = 86400, now = () => Math.floor(Date.now() / 1000);
const subscription = id => ({
  id, object: 'subscription', customer: 'cus_test_bea', status: 'active', cancel_at_period_end: false, currency: 'usd',
  items: { object: 'list', data: [{ id: 'si_test', current_period_start: now() - day, current_period_end: now() + 29 * day, price: { id: 'price_clubtest1', product: 'prod_clubtest1', unit_amount: 2900, currency: 'usd' } }] },
});
const real = globalThis.fetch;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
globalThis.fetch = async (url, init) => {
  const address = String(url?.url ?? url);
  if (address.startsWith('https://api.resend.com/')) {
    appendFileSync(outbox, JSON.stringify(JSON.parse(String(init?.body ?? '{}'))) + '\n');
    return reply({ id: 'email_test' });
  }
  if (!address.startsWith('https://api.stripe.com/')) return real(url, init);
  const path = new URL(address).pathname;
  let match;
  if ((match = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/line_items$/)))
    return reply({ object: 'list', url: path, has_more: false, data: [{ id: 'li_test', object: 'item', quantity: 1, price: { id: 'price_clubtest1', object: 'price', product: 'prod_clubtest1' } }] });
  if ((match = path.match(/^\/v1\/subscriptions\/([^/]+)$/))) return reply(subscription(match[1]));
  if ((match = path.match(/^\/v1\/customers\/([^/]+)$/))) return reply({ id: match[1], object: 'customer', email: 'bea@example.test', name: 'Bea Buyer' });
  return reply({ error: { type: 'invalid_request_error', message: 'not stubbed' } }, 404);
};
