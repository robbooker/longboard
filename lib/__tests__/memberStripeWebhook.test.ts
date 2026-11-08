import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { memoryMemberStore } from "./memberMemoryStore";
import { GRACE_MS, parseProductMap, purchaseAccess } from "@/lib/members/stripeEvents";
import type { StripeApi } from "@/lib/members/stripeEvents";

// #384: the Stripe webhook end to end on memory: real Stripe signatures (generateTestHeaderString),
// each event type, idempotency, ordering and the access rules. No Stripe request is ever made.
const m = vi.hoisted(() => ({ mem: null as unknown as ReturnType<typeof import("./memberMemoryStore").memoryMemberStore>, api: null as unknown }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({}) }));
vi.mock("@/lib/members/memberStore", () => ({ supabaseMemberStore: () => m.mem.store }));
vi.mock("@/lib/members/stripeApi", () => ({ stripeApi: () => m.api }));
import { POST } from "@/app/api/stripe/webhook/route";
import { NextRequest } from "next/server";

const SECRET = "whsec_synthetic_test_secret_never_a_real_one";
const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
let seq = 0;
const event = (type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: `evt_test_${++seq}`,
  object: "event",
  api_version: "2026-09-30.endive",
  created: nowS() + seq,
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  type,
  data: { object },
  ...extra,
});
const deliver = async (payload: object, { secret = SECRET, tamper = false, signature }: { secret?: string; tamper?: boolean; signature?: string | null } = {}) => {
  const body = JSON.stringify(payload);
  const header = signature === undefined ? Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) : signature;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header !== null) headers["stripe-signature"] = header;
  const response = await POST(new NextRequest("https://chat.robbooker.com/api/stripe/webhook", { method: "POST", headers, body: tamper ? body.replace("buyer", "other") : body }));
  return { status: response.status, body: await response.json() };
};
const checkout = (over: Record<string, unknown> = {}) => ({
  id: `cs_test_${seq}abcdefghijkl`,
  object: "checkout.session",
  mode: "payment",
  payment_status: "paid",
  status: "complete",
  amount_total: 4900,
  currency: "usd",
  customer: "cus_test_buyer",
  customer_details: { email: " Buyer@Example.test ", name: "Bea Buyer" },
  payment_intent: "pi_test_one",
  subscription: null,
  metadata: {},
  ...over,
});
const subscription = (over: Record<string, unknown> = {}, periodEnd = nowS() + 30 * DAY) => ({
  id: "sub_test_club",
  object: "subscription",
  customer: "cus_test_buyer",
  status: "active",
  cancel_at_period_end: false,
  canceled_at: null,
  currency: "usd",
  metadata: {},
  // Current API versions keep the period on the item.
  items: { object: "list", data: [{ id: "si_1", current_period_start: periodEnd - 30 * DAY, current_period_end: periodEnd, price: { id: "price_club_monthly", product: "prod_club", unit_amount: 2900, currency: "usd" } }] },
  ...over,
});
const fakeApi = (over: Partial<StripeApi> = {}): StripeApi => ({
  lineItems: vi.fn(async () => [{ priceId: "price_club_monthly", productId: "prod_club" }]),
  subscription: vi.fn(async () => subscription()),
  customerEmail: vi.fn(async () => ({ email: "buyer@example.test", name: "Bea Buyer" })),
  subscriptionForPaymentIntent: vi.fn(async () => null),
  ...over,
});

beforeEach(() => {
  m.mem = memoryMemberStore();
  m.api = fakeApi();
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  delete process.env.STRIPE_PRODUCT_MAP;
});

describe("signature", () => {
  it("refuses a missing, wrong-secret, tampered or stale signature before reading anything", async () => {
    const payload = event("checkout.session.completed", checkout());
    expect((await deliver(payload, { signature: null })).status).toBe(400);
    expect(await deliver(payload, { secret: "whsec_someone_else" })).toMatchObject({ status: 400, body: { error: "invalid_signature" } });
    expect((await deliver(payload, { tamper: true })).status).toBe(400);
    const old = Stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(payload), secret: SECRET, timestamp: nowS() - 3600 });
    expect((await deliver(payload, { signature: old })).status).toBe(400);
    expect(m.mem.events.size).toBe(0);
    expect(m.mem.people).toHaveLength(0);
  });
  it("is closed until STRIPE_WEBHOOK_SECRET is set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(await deliver(event("checkout.session.completed", checkout()))).toMatchObject({ status: 503, body: { error: "webhook_not_configured" } });
  });
});

describe("checkout.session.completed", () => {
  it("records the buyer by normalized email and grants the club's entitlements once, however often Stripe resends", async () => {
    m.api = fakeApi({ lineItems: vi.fn(async () => [{ priceId: "price_unknown", productId: "prod_unknown" }]) });
    const payload = event("checkout.session.completed", checkout({ metadata: { lb_product: "booker-stock-club" } }));
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { status: "processed", outcome: "granted:paid" } });
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { status: "duplicate" } });
    expect(m.mem.people).toEqual([expect.objectContaining({ email: "buyer@example.test", name: "Bea Buyer", stripe_customer_id: "cus_test_buyer" })]);
    expect(m.mem.purchases).toEqual([expect.objectContaining({ kind: "one_time", status: "paid", amount: 4900, currency: "usd", product_key: "booker-stock-club", stripe_payment_intent_id: "pi_test_one", event_ids: [payload.id] })]);
    expect(m.mem.entitlements.map((e) => [e.entitlement_key, e.granted_by, e.ends_at])).toEqual([["club-room", "stripe", null], ["gainers", "stripe", null], ["reader", "stripe", null]]);
    expect(m.mem.activeKeys("buyer@example.test")).toEqual(["club-room", "gainers", "reader"]);
  });
  it("maps the product from the price in the table, the env map, or not at all", async () => {
    await deliver(event("checkout.session.completed", checkout()));
    expect(m.mem.purchases[0]).toMatchObject({ product_key: "booker-stock-club", stripe_price_id: "price_club_monthly" });
    m.mem = memoryMemberStore();
    m.api = fakeApi({ lineItems: vi.fn(async () => [{ priceId: "price_envonly1", productId: null }]) });
    process.env.STRIPE_PRODUCT_MAP = "price_envonly1:one-month-pass";
    expect((await deliver(event("checkout.session.completed", checkout()))).body.outcome).toBe("granted:paid");
    expect(m.mem.entitlements[0]).toMatchObject({ entitlement_key: "gainers" });
    // access_days: one-time passes end.
    expect(Date.parse(m.mem.entitlements[0].ends_at!) - Date.parse(m.mem.purchases[0].created_at)).toBe(30 * DAY * 1000);
    m.mem = memoryMemberStore();
    m.api = fakeApi({ lineItems: vi.fn(async () => [{ priceId: "price_other", productId: "prod_other" }]) });
    expect((await deliver(event("checkout.session.completed", checkout()))).body.outcome).toBe("unmapped_product");
    expect(m.mem.purchases).toHaveLength(1);
    expect(m.mem.entitlements).toHaveLength(0);
  });
  it("waits for an async payment, then grants on async_payment_succeeded", async () => {
    const session = checkout({ payment_status: "unpaid" });
    expect((await deliver(event("checkout.session.completed", session))).body.outcome).toBe("awaiting_payment");
    expect(m.mem.purchases).toHaveLength(0);
    expect((await deliver(event("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid" }))).body.outcome).toBe("granted:paid");
  });
  it("works without STRIPE_SECRET_KEY when the session names the product", async () => {
    m.api = null;
    expect((await deliver(event("checkout.session.completed", checkout({ metadata: { lb_product: "booker-stock-club" } })))).body.outcome).toBe("granted:paid");
    expect((await deliver(event("checkout.session.completed", checkout({ id: "cs_test_nometa1234567", customer_details: { email: "two@example.test" } })))).body.outcome).toBe("unmapped_product");
  });
  it("answers 500 when the database fails, so Stripe sends it again, and the retry completes", async () => {
    const payload = event("checkout.session.completed", checkout());
    (m.mem.store as { failNext?: string }).failNext = "insertPurchase";
    expect(await deliver(payload)).toMatchObject({ status: 500, body: { error: "processing_failed" } });
    expect(m.mem.events.get(payload.id)).toMatchObject({ processed: false, error: expect.stringContaining("connection reset") });
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { status: "processed" } });
    expect(m.mem.events.get(payload.id)).toMatchObject({ processed: true, attempts: 2 });
    expect(m.mem.entitlements).toHaveLength(3);
  });
  it("records an event it doesn't use and does nothing", async () => {
    expect(await deliver(event("customer.created", { id: "cus_x", object: "customer" }))).toMatchObject({ status: 200, body: { status: "ignored" } });
  });
});

describe("subscriptions", () => {
  const club = () => checkout({ mode: "subscription", subscription: "sub_test_club", payment_intent: null, invoice: "in_first", amount_total: 2900 });
  const ends = () => m.mem.entitlements.map((e) => e.ends_at);
  it("grants until the period end plus three days, read from the subscription", async () => {
    const periodEnd = nowS() + 30 * DAY;
    m.api = fakeApi({ subscription: vi.fn(async () => subscription({}, periodEnd)) });
    expect((await deliver(event("checkout.session.completed", club()))).body.outcome).toBe("granted:active");
    expect(m.mem.purchases[0]).toMatchObject({ kind: "subscription", status: "active", stripe_subscription_id: "sub_test_club", current_period_end: new Date(periodEnd * 1000).toISOString() });
    expect(ends()).toEqual(Array(3).fill(new Date(periodEnd * 1000 + GRACE_MS).toISOString()));
  });
  it("subscription.created before the checkout: the buyer comes from the customer, nothing is doubled", async () => {
    expect((await deliver(event("customer.subscription.created", subscription()))).body.outcome).toBe("granted:active");
    expect((await deliver(event("checkout.session.completed", club()))).body.outcome).toBe("granted:active");
    expect(m.mem.people).toHaveLength(1);
    expect(m.mem.purchases).toHaveLength(1);
    expect(m.mem.purchases[0]).toMatchObject({ stripe_checkout_session_id: expect.stringMatching(/^cs_test_/), stripe_subscription_id: "sub_test_club" });
    expect(m.mem.entitlements).toHaveLength(3);
  });
  it("renewal (invoice.paid) extends; payment_failed keeps access; cancel at period end ends there; deleted revokes", async () => {
    const first = nowS() + 10 * DAY;
    m.api = fakeApi({ subscription: vi.fn(async () => subscription({}, first)) });
    await deliver(event("checkout.session.completed", club()));
    const next = first + 30 * DAY;
    // Current API shape: the subscription is under parent.subscription_details.
    const invoice = { id: "in_renew", object: "invoice", customer: "cus_test_buyer", amount_paid: 2900, currency: "usd", parent: { type: "subscription_details", subscription_details: { subscription: "sub_test_club" } }, lines: { data: [{ period: { start: first, end: next } }] } };
    expect((await deliver(event("invoice.paid", invoice))).body.outcome).toBe("granted:active");
    expect(ends()).toEqual(Array(3).fill(new Date(next * 1000 + GRACE_MS).toISOString()));
    expect(m.mem.purchases[0]).toMatchObject({ stripe_invoice_id: "in_renew", current_period_end: new Date(next * 1000).toISOString() });
    // Older API shape: invoice.subscription.
    expect((await deliver(event("invoice.payment_failed", { id: "in_fail", object: "invoice", subscription: "sub_test_club" }))).body.outcome).toBe("granted:past_due");
    expect(m.mem.purchases[0].status).toBe("past_due");
    expect(m.mem.activeKeys("buyer@example.test")).toEqual(["club-room", "gainers", "reader"]);
    expect((await deliver(event("customer.subscription.updated", subscription({ cancel_at_period_end: true }, next)))).body.outcome).toBe("granted:active");
    expect(ends()).toEqual(Array(3).fill(new Date(next * 1000).toISOString()));
    const deleted = event("customer.subscription.deleted", subscription({ status: "canceled", ended_at: nowS() }, next));
    expect((await deliver(deleted)).body.outcome).toBe("revoked:subscription_canceled");
    expect(m.mem.entitlements.every((e) => e.revoked_by === "stripe" && e.revoked_reason === "subscription_canceled")).toBe(true);
    expect(m.mem.activeKeys("buyer@example.test")).toEqual([]);
    // A late, older "active" update can't bring it back.
    const stale = event("customer.subscription.updated", subscription({}, next), { created: deleted.created - 100 });
    expect((await deliver(stale)).body.outcome).toBe("stale");
    expect(m.mem.activeKeys("buyer@example.test")).toEqual([]);
  });
  it("unpaid and incomplete subscriptions have no access", async () => {
    await deliver(event("customer.subscription.created", subscription({ status: "incomplete" })));
    expect(m.mem.entitlements).toHaveLength(0);
    expect((await deliver(event("customer.subscription.updated", subscription({ status: "active" })))).body.outcome).toBe("granted:active");
    expect((await deliver(event("customer.subscription.updated", subscription({ status: "unpaid" })))).body.outcome).toBe("revoked:subscription_unpaid");
  });
  it("a subscription event with no way to find the buyer waits for the checkout", async () => {
    m.api = null;
    expect((await deliver(event("customer.subscription.created", subscription()))).body.outcome).toBe("waiting_for_checkout");
  });
  it("an admin's revoke stands through renewals", async () => {
    await deliver(event("checkout.session.completed", club()));
    const gainers = m.mem.entitlements.find((e) => e.entitlement_key === "gainers")!;
    Object.assign(gainers, { revoked_at: new Date().toISOString(), revoked_by: "admin", revoked_reason: "chargeback" });
    await deliver(event("invoice.paid", { id: "in_2", object: "invoice", subscription: "sub_test_club", lines: { data: [{ period: { end: nowS() + 60 * DAY } }] } }));
    expect(m.mem.activeKeys("buyer@example.test")).toEqual(["club-room", "reader"]);
  });
});

describe("charge.refunded", () => {
  it("a full refund revokes the purchase's access; a partial one is only recorded", async () => {
    await deliver(event("checkout.session.completed", checkout()));
    const charge = { id: "ch_1", object: "charge", payment_intent: "pi_test_one", amount: 4900, amount_refunded: 1000, refunded: false };
    expect((await deliver(event("charge.refunded", charge))).body.outcome).toBe("partial_refund");
    expect(m.mem.purchases[0]).toMatchObject({ refunded: false, refunded_amount: 1000 });
    expect(m.mem.activeKeys("buyer@example.test")).toHaveLength(3);
    expect((await deliver(event("charge.refunded", { ...charge, amount_refunded: 4900, refunded: true }))).body.outcome).toBe("revoked:refunded");
    expect(m.mem.purchases[0]).toMatchObject({ refunded: true, status: "refunded", refunded_amount: 4900 });
    expect(m.mem.activeKeys("buyer@example.test")).toEqual([]);
  });
  it("finds a subscription's purchase through its invoice payment", async () => {
    await deliver(event("checkout.session.completed", checkout({ mode: "subscription", subscription: "sub_test_club", payment_intent: null })));
    m.api = fakeApi({ subscriptionForPaymentIntent: vi.fn(async () => "sub_test_club") });
    expect((await deliver(event("charge.refunded", { id: "ch_2", object: "charge", payment_intent: "pi_sub_invoice", amount: 2900, amount_refunded: 2900, refunded: true }))).body.outcome).toBe("revoked:refunded");
    // A later renewal or update doesn't bring a refunded purchase back.
    await deliver(event("customer.subscription.updated", subscription()));
    expect(m.mem.activeKeys("buyer@example.test")).toEqual([]);
  });
  it("a refund for something we never sold is recorded and ignored", async () => {
    expect((await deliver(event("charge.refunded", { id: "ch_3", object: "charge", payment_intent: "pi_elsewhere", amount: 100, amount_refunded: 100, refunded: true }))).body.outcome).toBe("unknown_purchase");
  });
});

describe("access rules", () => {
  const base = { kind: "subscription", status: "active", refunded: false, cancel_at_period_end: false, current_period_end: "2026-12-01T00:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z" } as never;
  const now = new Date("2026-11-08T00:00:00Z");
  it("follows status, period and refunds", () => {
    expect(purchaseAccess(base, { access_days: null }, now)).toEqual({ active: true, endsAt: "2026-12-04T00:00:00.000Z", reason: "active" });
    expect(purchaseAccess({ ...(base as object), cancel_at_period_end: true } as never, { access_days: null }, now).endsAt).toBe("2026-12-01T00:00:00.000Z");
    expect(purchaseAccess({ ...(base as object), current_period_end: null } as never, { access_days: null }, now).endsAt).toBe("2026-11-11T00:00:00.000Z");
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"])
      expect(purchaseAccess({ ...(base as object), status } as never, { access_days: null }, now).active).toBe(false);
    expect(purchaseAccess({ ...(base as object), refunded: true } as never, { access_days: null }, now)).toMatchObject({ active: false, reason: "refunded" });
    expect(purchaseAccess({ ...(base as object), kind: "one_time", status: "paid" } as never, { access_days: 7 }, now).endsAt).toBe("2026-11-08T00:00:00.000Z");
  });
  it("reads STRIPE_PRODUCT_MAP and skips anything malformed", () => {
    expect([...parseProductMap("price_A1:booker-stock-club, prod_B2=booker-stock-club bad:x price_C3:Bad_Key")]).toEqual([
      ["price_A1", "booker-stock-club"],
      ["prod_B2", "booker-stock-club"],
    ]);
    expect(parseProductMap(undefined).size).toBe(0);
  });
});
