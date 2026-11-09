import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { NextRequest } from "next/server";
import { memoryMemberStore } from "./memberMemoryStore";
import { memoryWelcomeStore } from "./memberWelcomeMemoryStore";
import type { StripeApi } from "@/lib/members/stripeEvents";

// #390: the welcome through the real routes, on memory: the Stripe webhook (Stripe's own test
// signatures) sends one welcome on a first grant only and never fails on a send; the welcome page
// and its POST; the thank-you page's checkout-session sign-in; "Email me a new link"; the admin
// resend. Resend is answered by a stubbed fetch; nothing leaves the machine.
const m = vi.hoisted(() => ({
  mem: null as unknown as ReturnType<typeof import("./memberMemoryStore").memoryMemberStore>,
  w: null as unknown as ReturnType<typeof import("./memberWelcomeMemoryStore").memoryWelcomeStore>,
  api: null as unknown,
  chatUser: { ok: false, status: 401 } as Record<string, unknown>,
  admin: { ok: true, user: { id: "admin-1", role: "admin" } } as Record<string, unknown>,
}));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({}), requestOriginAllowed: () => true }));
vi.mock("@/lib/members/memberStore", () => ({ supabaseMemberStore: () => m.mem.store }));
vi.mock("@/lib/members/stripeApi", () => ({ stripeApi: () => m.api }));
vi.mock("@/lib/members/welcome", async (original) => ({ ...(await original<typeof import("@/lib/members/welcome")>()), supabaseWelcomeStore: () => m.w.store }));
// joinStatus reads Supabase directly: answer it from memory (the session's buyer, if recorded).
vi.mock("@/lib/members/join", async (original) => ({
  ...(await original<typeof import("@/lib/members/join")>()),
  joinStatus: async (_db: unknown, by: { sessionId?: string }) => {
    const purchase = m.mem.purchases.find((p) => p.stripe_checkout_session_id === by.sessionId);
    const person = purchase && m.mem.people.find((p) => p.id === purchase.person_id);
    return person ? { status: "ready", email: person.email } : { status: "pending" };
  },
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: async () => m.chatUser }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => m.admin }));
vi.mock("@/lib/fonts/gainersFonts", () => ({ gainersHead: { variable: "h" }, gainersBody: { variable: "b" } }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { POST as redeem } from "@/app/api/members/join/welcome/route";
import { POST as resend } from "@/app/api/members/join/welcome/resend/route";
import { POST as checkoutSession } from "@/app/api/members/join/session/route";
import { GET as status } from "@/app/api/members/join/status/route";
import { POST as adminResend } from "@/app/api/admin/members/welcome/route";
import WelcomePage from "@/app/join/club/welcome/page";
import { welcomeTokenHash } from "@/lib/members/welcome";

const SECRET = "whsec_synthetic_welcome_test_secret_never_real";
const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
let seq = 0;
let outbox: { to: string[]; subject: string; text: string; html: string }[];
let resendStatus = 200;
const event = (type: string, object: Record<string, unknown>, created = nowS() + ++seq) => ({
  id: `evt_test_welcome_${++seq}`, object: "event", api_version: "2026-09-30.endive", created, livemode: false, pending_webhooks: 1,
  request: { id: null, idempotency_key: null }, type, data: { object },
});
const deliver = async (payload: object) => {
  const body = JSON.stringify(payload);
  const response = await webhook(new NextRequest("https://chat.robbooker.com/api/stripe/webhook", {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) }, body,
  }));
  return { status: response.status, body: await response.json() };
};
const post = async (handler: (r: NextRequest) => Promise<Response>, path: string, payload: unknown) => {
  const response = await handler(new NextRequest(`https://chat.robbooker.com${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie") };
};
const SESSION = "cs_test_welcomeBuyer12345";
const checkout = (over: Record<string, unknown> = {}) => ({
  id: SESSION, object: "checkout.session", mode: "subscription", payment_status: "paid", status: "complete", amount_total: 100, currency: "usd",
  customer: "cus_test_bea", subscription: "sub_test_bea", customer_details: { email: "Bea@Example.test", name: "Bea Buyer" }, metadata: {}, ...over,
});
const subscription = (periodEnd = nowS() + 30 * DAY) => ({
  id: "sub_test_bea", object: "subscription", customer: "cus_test_bea", status: "active", cancel_at_period_end: false, metadata: {},
  items: { object: "list", data: [{ id: "si_1", current_period_start: periodEnd - 30 * DAY, current_period_end: periodEnd, price: { id: "price_club_monthly", product: "prod_club", unit_amount: 100, currency: "usd" } }] },
});
const fakeApi = (): StripeApi => ({
  lineItems: vi.fn(async () => [{ priceId: "price_club_monthly", productId: "prod_club" }]),
  subscription: vi.fn(async () => subscription()),
  customerEmail: vi.fn(async () => ({ email: "bea@example.test", name: "Bea Buyer" })),
  subscriptionForPaymentIntent: vi.fn(async () => null),
});
const tokenIn = (mail: { text: string }) => mail.text.match(/\/join\/club\/welcome\?t=([A-Za-z0-9_-]{43})/)?.[1];
const bea = () => m.mem.people.find((p) => p.email === "bea@example.test")!;
/** Make the clock jump by moving every stored time back (the routes use the real clock). */
const ageEverything = (ms: number) => {
  for (const p of m.mem.people) if (p.welcome_updated_at) p.welcome_updated_at = new Date(Date.parse(p.welcome_updated_at) - ms).toISOString();
  for (const p of m.mem.purchases) p.created_at = new Date(Date.parse(p.created_at) - ms).toISOString();
  for (const t of m.w.tokens) {
    t.created_at = new Date(Date.parse(t.created_at) - ms).toISOString();
    t.expires_at = new Date(Date.parse(t.expires_at) - ms).toISOString();
  }
};

beforeEach(() => {
  m.mem = memoryMemberStore();
  m.w = memoryWelcomeStore(m.mem);
  m.api = fakeApi();
  m.chatUser = { ok: false, status: 401 };
  m.admin = { ok: true, user: { id: "admin-1", role: "admin" } };
  outbox = [];
  resendStatus = 200;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.RESEND_API_KEY = "re_synthetic_never_real";
  process.env.MEMBERS_FROM_EMAIL = "Booker Stock Club <club@example.test>";
  process.env.MEMBERS_CHAT_URL = "https://chat.robbooker.com";
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      if (resendStatus !== 200) return new Response("{}", { status: resendStatus });
      outbox.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
    }
    return real(url, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the webhook's welcome", () => {
  it("goes exactly once, on the first grant: not on a resend, a renewal or a late event", async () => {
    const paid = event("checkout.session.completed", checkout());
    expect((await deliver(paid)).body).toEqual({ received: true, status: "processed", outcome: "granted:active" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: ["bea@example.test"], subject: "Welcome to the Booker Stock Club", from: "Booker Stock Club <club@example.test>" });
    expect(outbox[0].html).toContain(">Open the club chat</a>");
    expect(bea()).toMatchObject({ welcome_status: "sent", welcome_kind: "club", welcome_attempts: 1 });
    // Stripe resends the same event.
    expect((await deliver(paid)).body.status).toBe("duplicate");
    // The renewal.
    const invoice = { id: "in_renew", object: "invoice", customer: "cus_test_bea", amount_paid: 100, currency: "usd", parent: { type: "subscription_details", subscription_details: { subscription: "sub_test_bea" } }, lines: { data: [{ period: { end: nowS() + 60 * DAY } }] } };
    expect((await deliver(event("invoice.paid", invoice))).body.outcome).toBe("granted:active");
    // A late subscription event, and checkout.session.async_payment_succeeded for the same session.
    await deliver(event("customer.subscription.updated", subscription(), nowS() - 3600));
    await deliver(event("checkout.session.async_payment_succeeded", checkout()));
    expect(outbox).toHaveLength(1);
    expect(m.w.tokens).toHaveLength(1);
  });
  it("a failed send doesn't fail the webhook; a later webhook retries it once", async () => {
    resendStatus = 500;
    expect(await deliver(event("checkout.session.completed", checkout()))).toMatchObject({ status: 200, body: { status: "processed", outcome: "granted:active" } });
    expect(bea()).toMatchObject({ welcome_status: "failed", welcome_error: "resend_500", welcome_attempts: 1 });
    resendStatus = 200;
    // Another buyer's purchase a few minutes later carries the retry.
    ageEverything(3 * 60 * 1000);
    m.api = { ...fakeApi(), customerEmail: vi.fn(async () => ({ email: "cy@example.test", name: null })) };
    await deliver(event("checkout.session.completed", checkout({ id: "cs_test_cyBuyer1234567", subscription: "sub_test_cy", customer: "cus_test_cy", customer_details: { email: "cy@example.test" } })));
    expect(outbox.map((mail) => mail.to[0]).sort()).toEqual(["bea@example.test", "cy@example.test"]);
    expect(bea()).toMatchObject({ welcome_status: "sent", welcome_attempts: 2 });
  });
  it("only one automatic retry", async () => {
    resendStatus = 503;
    await deliver(event("checkout.session.completed", checkout()));
    for (let i = 0; i < 3; i++) {
      ageEverything(3 * 60 * 1000);
      await deliver(event("invoice.paid", { id: `in_${i}`, object: "invoice", subscription: "sub_test_bea", lines: { data: [] } }));
    }
    expect(bea()).toMatchObject({ welcome_status: "failed", welcome_attempts: 2 });
  });
  it("a Longboard account's email gets the Longboard welcome, no token", async () => {
    m.w.longboard.add("bea@example.test");
    await deliver(event("checkout.session.completed", checkout()));
    expect(outbox).toHaveLength(1);
    expect(outbox[0].text).toContain("https://chat.robbooker.com/login?next=%2Fchat%3Froom%3Dgainers");
    expect(outbox[0].html).toContain(">Sign in with Longboard</a>");
    expect(m.w.tokens).toHaveLength(0);
    expect(bea()).toMatchObject({ welcome_status: "sent", welcome_kind: "longboard" });
  });
  it("someone who signed up with a code first doesn't need one", async () => {
    await m.mem.store.upsertPerson("bea@example.test", { name: "Bea Buyer" });
    bea().chat_account_id = "22222222-2222-4222-8222-222222222222";
    await deliver(event("checkout.session.completed", checkout()));
    expect(outbox).toHaveLength(0);
    expect(bea().welcome_status).toBe("not_needed");
  });
});

describe("the welcome link", () => {
  const welcomed = async () => {
    await deliver(event("checkout.session.completed", checkout()));
    return tokenIn(outbox[0])!;
  };
  const page = async (t: string) => {
    const element = (await WelcomePage({ searchParams: Promise.resolve({ t }) })) as { props: { initialState: string; token: string | null } };
    return element.props;
  };
  it("opening it (GET) never uses it; the button (POST) does, once", async () => {
    const t = await welcomed();
    for (let i = 0; i < 3; i++) expect(await page(t)).toMatchObject({ initialState: "ready", token: t });
    expect(m.w.tokens[0].consumed_at).toBeNull();
    const first = await post(redeem, "/api/members/join/welcome", { t });
    expect(first).toMatchObject({ status: 200, body: { ok: true, needsName: true, name: "Bea Buyer", next: "/chat?room=gainers" } });
    expect(first.cookie).toMatch(/^lb-chat-session=/);
    expect(bea().chat_account_id).toBeTruthy();
    expect(m.w.sessions).toHaveLength(1);
    expect(await post(redeem, "/api/members/join/welcome", { t })).toMatchObject({ status: 410, body: { error: "used" } });
    expect(await page(t)).toMatchObject({ initialState: "used" });
  });
  it("expired and unknown links get friendly pages and no session", async () => {
    const t = await welcomed();
    ageEverything(8 * DAY * 1000);
    expect(await page(t)).toMatchObject({ initialState: "expired" });
    expect(await post(redeem, "/api/members/join/welcome", { t })).toMatchObject({ status: 410, body: { error: "expired" } });
    expect(await page("A".repeat(43))).toMatchObject({ initialState: "invalid", token: null });
    expect(await page("nonsense")).toMatchObject({ initialState: "invalid" });
    expect(await post(redeem, "/api/members/join/welcome", { t: "nonsense" })).toMatchObject({ status: 404 });
    expect(m.w.sessions).toHaveLength(0);
  });
  it("a signed-in club member opening it goes to the room, leaving it unused", async () => {
    const t = await welcomed();
    m.chatUser = { ok: true, access: { member: ["gainers"] }, user: { id: "x" } };
    await expect(page(t)).rejects.toThrow("redirect:/chat?room=gainers");
    expect(m.w.tokens[0].consumed_at).toBeNull();
  });
  it("Email me a new link: works from an expired or used link, only to the purchase email, 3 an hour", async () => {
    const t = await welcomed();
    ageEverything(8 * DAY * 1000);
    for (let i = 0; i < 3; i++) expect(await post(resend, "/api/members/join/welcome/resend", { t })).toMatchObject({ status: 200, body: { sent: true } });
    expect(await post(resend, "/api/members/join/welcome/resend", { t })).toMatchObject({ status: 429, body: { error: "too_many_links" } });
    expect(outbox.map((mail) => mail.to[0])).toEqual(Array(4).fill("bea@example.test"));
    expect(JSON.stringify((await post(resend, "/api/members/join/welcome/resend", { t })).body)).not.toContain("bea@");
    const fresh = tokenIn(outbox.at(-1)!)!;
    expect(await post(redeem, "/api/members/join/welcome", { t: fresh })).toMatchObject({ status: 200 });
    expect(await post(resend, "/api/members/join/welcome/resend", { t: "B".repeat(43) })).toMatchObject({ status: 404 });
  });
});

describe("the thank-you page (checkout session)", () => {
  const purchased = async () => {
    await deliver(event("checkout.session.completed", checkout()));
    // The memory store stamps rows on a fixed past clock; this purchase is from just now.
    for (const p of m.mem.purchases) p.created_at = new Date().toISOString();
  };
  it("offers one tap, and signs in with nothing typed, once per session", async () => {
    await purchased();
    const ask = await status(new NextRequest(`https://chat.robbooker.com/api/members/join/status?session_id=${SESSION}`));
    expect(await ask.json()).toEqual({ status: "ready", email: "bea@example.test", oneTap: true });
    const issued = await post(checkoutSession, "/api/members/join/session", { session_id: SESSION });
    expect(issued).toMatchObject({ status: 200, body: { token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) } });
    expect(m.w.tokens.find((t) => t.token_hash === welcomeTokenHash(issued.body.token))).toMatchObject({ purpose: "checkout", checkout_session_id: SESSION });
    expect(await post(redeem, "/api/members/join/welcome", { t: issued.body.token })).toMatchObject({ status: 200, body: { needsName: true } });
    // Used: the same session can't sign in again (another browser, or after signing out).
    expect(await post(checkoutSession, "/api/members/join/session", { session_id: SESSION })).toMatchObject({ status: 409, body: { error: "linked" } });
    bea().chat_account_id = null;
    expect(await post(checkoutSession, "/api/members/join/session", { session_id: SESSION })).toMatchObject({ status: 410, body: { error: "session_used" } });
    const after = await status(new NextRequest(`https://chat.robbooker.com/api/members/join/status?session_id=${SESSION}`));
    expect((await after.json()).oneTap).toBe(false);
  });
  it("a token made from the session can't be used once another one was", async () => {
    await purchased();
    const a = (await post(checkoutSession, "/api/members/join/session", { session_id: SESSION })).body.token;
    const b = (await post(checkoutSession, "/api/members/join/session", { session_id: SESSION })).body.token;
    expect((await post(redeem, "/api/members/join/welcome", { t: a })).status).toBe(200);
    expect(await post(redeem, "/api/members/join/welcome", { t: b })).toMatchObject({ status: 410, body: { error: "session_used" } });
  });
  it("only within 2 hours of the purchase", async () => {
    await purchased();
    ageEverything(2 * 60 * 60 * 1000 + 60_000);
    expect(await post(checkoutSession, "/api/members/join/session", { session_id: SESSION })).toMatchObject({ status: 410, body: { error: "too_old" } });
    const ask = await status(new NextRequest(`https://chat.robbooker.com/api/members/join/status?session_id=${SESSION}`));
    expect((await ask.json()).oneTap).toBe(false);
  });
  it("before the purchase is recorded: pending; a bad id: refused; at most 5 presses an hour", async () => {
    expect(await post(checkoutSession, "/api/members/join/session", { session_id: SESSION })).toMatchObject({ status: 404, body: { error: "pending" } });
    expect(await post(checkoutSession, "/api/members/join/session", { session_id: "{CHECKOUT_SESSION_ID}" })).toMatchObject({ status: 400 });
    await purchased();
    for (let i = 0; i < 5; i++) expect((await post(checkoutSession, "/api/members/join/session", { session_id: SESSION })).status).toBe(200);
    expect(await post(checkoutSession, "/api/members/join/session", { session_id: SESSION })).toMatchObject({ status: 429, body: { error: "too_many_tries" } });
  });
});

describe("admin resend", () => {
  it("sends a new welcome and records it; admins only", async () => {
    resendStatus = 500;
    await deliver(event("checkout.session.completed", checkout()));
    resendStatus = 200;
    expect(await post(adminResend, "/api/admin/members/welcome", { person_id: bea().id })).toMatchObject({ status: 200, body: { welcome_status: "sent" } });
    expect(bea()).toMatchObject({ welcome_status: "sent", welcome_attempts: 2 });
    expect(outbox).toHaveLength(1);
    expect(await post(adminResend, "/api/admin/members/welcome", { person_id: "33333333-3333-4333-8333-333333333333" })).toMatchObject({ status: 404 });
    m.admin = { ok: false, status: 403, error: "forbidden" };
    expect(await post(adminResend, "/api/admin/members/welcome", { person_id: bea().id })).toMatchObject({ status: 403 });
  });
});
