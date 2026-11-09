import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryMemberStore } from "./memberMemoryStore";
import { memoryWelcomeStore } from "./memberWelcomeMemoryStore";
import {
  CHECKOUT_TOKEN_TTL_MS,
  WELCOME_TTL_MS,
  checkoutSignIn,
  deliverWelcome,
  issueWelcomeToken,
  newWelcomeToken,
  retryWelcomes,
  suggestedName,
  validWelcomeToken,
  welcomeEmail,
  welcomeTokenHash,
  welcomeTokenState,
  type Mail,
} from "@/lib/members/welcome";

// #390: the welcome email's tokens, sends and retries, on memory.
let clock = new Date("2026-11-08T15:00:00Z");
const later = (ms: number) => (clock = new Date(clock.getTime() + ms));
let mem: ReturnType<typeof memoryMemberStore>;
let w: ReturnType<typeof memoryWelcomeStore>;
let outbox: Mail[];
let failSend: string | null;
const mailer = vi.fn(async (mail: Mail) => {
  if (failSend) return { ok: false, error: failSend };
  outbox.push(mail);
  return { ok: true };
});
const deps = () => ({ mailer, now: () => clock });

/** A buyer with the club's entitlements, bought `ago` ms before the clock. */
async function buyer(email = "bea@example.test", ago = 60_000, sessionId = "cs_test_welcome1234567") {
  const person = await mem.store.upsertPerson(email, { name: "Bea Buyer" });
  const purchase = await mem.store.insertPurchase({
    person_id: person.id, product_key: "booker-stock-club", kind: "one_time", status: "paid", stripe_customer_id: null,
    stripe_checkout_session_id: sessionId, stripe_subscription_id: null, stripe_payment_intent_id: null, stripe_invoice_id: null,
    stripe_price_id: null, stripe_product_id: null, amount: 100, currency: "usd", livemode: false, current_period_start: null,
    current_period_end: null, cancel_at_period_end: false, canceled: false, canceled_at: null, refunded: false, refunded_amount: 0,
    last_event_at: null, event_ids: [],
  });
  mem.purchases.find((p) => p.id === purchase.id)!.created_at = new Date(clock.getTime() - ago).toISOString();
  await mem.store.insertEntitlement({
    person_id: person.id, entitlement_key: "gainers", product_key: "booker-stock-club", purchase_id: purchase.id,
    starts_at: new Date(clock.getTime() - ago).toISOString(), ends_at: null, granted_by: "stripe", granted_by_user: null, note: null,
    revoked_at: null, revoked_by: null, revoked_by_user: null, revoked_reason: null,
  });
  return mem.people.find((p) => p.id === person.id)!;
}
const linkToken = (mail: Mail) => mail.text.match(/\/join\/club\/welcome\?t=([A-Za-z0-9_-]{43})/)?.[1];

beforeEach(() => {
  clock = new Date("2026-11-08T15:00:00Z");
  mem = memoryMemberStore();
  w = memoryWelcomeStore(mem, { now: () => clock });
  outbox = [];
  failSend = null;
  mailer.mockClear();
  process.env.MEMBERS_CHAT_URL = "https://chat.robbooker.com";
});

describe("welcome tokens", () => {
  it("are 32 random bytes, stored only as a sha256 hash", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const t = newWelcomeToken();
      expect(validWelcomeToken(t)).toBe(true);
      expect(Buffer.from(t, "base64url")).toHaveLength(32);
      seen.add(t);
    }
    expect(seen.size).toBe(50);
    const person = await buyer();
    const token = await issueWelcomeToken(w.store, person, "email", null, clock);
    expect(w.tokens).toHaveLength(1);
    expect(w.tokens[0]).toMatchObject({ person_id: person.id, email: "bea@example.test", purpose: "email", token_hash: welcomeTokenHash(token) });
    expect(JSON.stringify(w.tokens)).not.toContain(token);
    expect(welcomeTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    for (const bad of [null, 42, "", "short", `${token}x`, token.slice(1) + "!"]) expect(validWelcomeToken(bad)).toBe(false);
  });
  it("last 7 days from email, 15 minutes from checkout", async () => {
    const person = await buyer();
    const email = await issueWelcomeToken(w.store, person, "email", null, clock);
    const checkout = await issueWelcomeToken(w.store, person, "checkout", "cs_test_welcome1234567", clock);
    expect(Date.parse(w.tokens[0].expires_at) - clock.getTime()).toBe(WELCOME_TTL_MS);
    expect(Date.parse(w.tokens[1].expires_at) - clock.getTime()).toBe(CHECKOUT_TOKEN_TTL_MS);
    expect((await welcomeTokenState(w.store, email, clock)).state).toBe("ready");
    later(16 * 60 * 1000);
    expect((await welcomeTokenState(w.store, checkout, clock)).state).toBe("expired");
    later(WELCOME_TTL_MS);
    expect((await welcomeTokenState(w.store, email, clock)).state).toBe("expired");
    expect(await w.store.redeem(welcomeTokenHash(email), "a".repeat(64), clock)).toEqual({ status: "expired" });
    expect((await welcomeTokenState(w.store, newWelcomeToken(), clock)).state).toBe("invalid");
  });
  it("work once; checking one never uses it", async () => {
    const person = await buyer();
    const token = await issueWelcomeToken(w.store, person, "email", null, clock);
    for (let i = 0; i < 3; i++) expect((await welcomeTokenState(w.store, token, clock)).state).toBe("ready");
    expect(await w.store.redeem(welcomeTokenHash(token), "a".repeat(64), clock)).toMatchObject({ status: "ok", member: false, name: "Bea Buyer" });
    expect(mem.people[0].chat_account_id).toBeTruthy();
    expect(await w.store.redeem(welcomeTokenHash(token), "b".repeat(64), clock)).toEqual({ status: "used" });
    expect((await welcomeTokenState(w.store, token, clock)).state).toBe("used");
    expect(w.sessions).toHaveLength(1);
  });
  it("the chat name is filled in from Stripe when it is a valid chat name", () => {
    expect(suggestedName("Bea Buyer")).toBe("Bea Buyer");
    expect(suggestedName("  Bea   Buyer ")).toBe("Bea Buyer");
    expect(suggestedName(null)).toBe("");
    expect(suggestedName("x")).toBe("");
  });
});

describe("the welcome email", () => {
  it("has one button to the welcome link", () => {
    const mail = welcomeEmail("club", "https://chat.robbooker.com/join/club/welcome?t=abc", "Bea Buyer");
    expect(mail.subject).toBe("Welcome to the Booker Stock Club");
    expect(mail.html.match(/<a /g)).toHaveLength(2); // the button and the copy-this-address fallback
    expect(mail.html).toContain(">Open the club chat</a>");
    expect(mail.html).toContain('href="https://chat.robbooker.com/join/club/welcome?t=abc"');
    expect(mail.text).toContain("Hi Bea,");
    expect(mail.text).toContain("the Gainers room, the Gainers Table, the News Feed, the Reader and the Booker Stock Club room");
  });
  it("for a Longboard account says the club is on it and links to the Longboard sign-in", () => {
    const mail = welcomeEmail("longboard", "https://chat.robbooker.com/login?next=%2Fchat%3Froom%3Dgainers", null);
    expect(mail.html).toContain(">Sign in with Longboard</a>");
    expect(mail.text).toMatch(/now on your Longboard account/);
    expect(mail.text).not.toMatch(/welcome\?t=/);
  });
  it("escapes the buyer's name", () => {
    expect(welcomeEmail("club", "https://x.test/", "<b>Bea</b>").html).not.toContain("<b>Bea");
  });
});

describe("sending", () => {
  it("goes once for a person, with a working one-tap link", async () => {
    const person = await buyer();
    expect(await deliverWelcome(w.store, person.id, "first", deps())).toBe("sent");
    expect(await deliverWelcome(w.store, person.id, "first", deps())).toBe("skipped");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("bea@example.test");
    const token = linkToken(outbox[0])!;
    expect(outbox[0].html).toContain(`https://chat.robbooker.com/join/club/welcome?t=${token}`);
    expect((await welcomeTokenState(w.store, token, clock)).state).toBe("ready");
    expect(mem.people[0]).toMatchObject({ welcome_status: "sent", welcome_kind: "club", welcome_attempts: 1, welcome_sent_at: clock.toISOString() });
  });
  it("isn't needed for someone who already has a chat account", async () => {
    const person = await buyer();
    person.chat_account_id = "11111111-1111-4111-8111-111111111111";
    expect(await deliverWelcome(w.store, person.id, "first", deps())).toBe("not_needed");
    expect(outbox).toHaveLength(0);
    // An admin can still send one.
    expect(await deliverWelcome(w.store, person.id, "admin", deps())).toBe("sent");
  });
  it("to a Longboard account's email: no token, the Longboard sign-in", async () => {
    const person = await buyer("lb@example.test");
    w.longboard.add("lb@example.test");
    expect(await deliverWelcome(w.store, person.id, "first", deps())).toBe("sent");
    expect(w.tokens).toHaveLength(0);
    expect(outbox[0].text).toContain("https://chat.robbooker.com/login?next=%2Fchat%3Froom%3Dgainers");
    expect(mem.people[0]).toMatchObject({ welcome_status: "sent", welcome_kind: "longboard" });
  });
  it("a failed send is recorded, retried once after two minutes, then left for an admin", async () => {
    const person = await buyer();
    failSend = "resend_500";
    expect(await deliverWelcome(w.store, person.id, "first", deps())).toBe("failed");
    expect(mem.people[0]).toMatchObject({ welcome_status: "failed", welcome_error: "resend_500", welcome_attempts: 1 });
    expect(await retryWelcomes(w.store, 5, deps())).toEqual([]); // too soon
    later(3 * 60 * 1000);
    expect(await retryWelcomes(w.store, 5, deps())).toEqual(["failed"]);
    later(3 * 60 * 1000);
    expect(await retryWelcomes(w.store, 5, deps())).toEqual([]); // only once
    failSend = null;
    expect(await deliverWelcome(w.store, person.id, "admin", deps())).toBe("sent");
    expect(mem.people[0]).toMatchObject({ welcome_status: "sent", welcome_attempts: 3 });
  });
  it("a retry that works is recorded as sent", async () => {
    const person = await buyer();
    failSend = "resend_timeout";
    await deliverWelcome(w.store, person.id, "first", deps());
    failSend = null;
    later(3 * 60 * 1000);
    expect(await retryWelcomes(w.store, 5, deps())).toEqual(["sent"]);
    expect(outbox).toHaveLength(1);
  });
  it("a store failure while sending is recorded, never thrown", async () => {
    const person = await buyer();
    w.store.insertToken = async () => {
      throw new Error("token_insert: down");
    };
    expect(await deliverWelcome(w.store, person.id, "first", deps())).toBe("failed");
    expect(mem.people[0]).toMatchObject({ welcome_status: "failed", welcome_error: "token_insert: down" });
  });
});

describe("thank-you page sign-in by checkout session", () => {
  it("works within 2 hours, for an unlinked buyer, once per session", async () => {
    const person = await buyer();
    expect(await checkoutSignIn(w.store, "cs_test_welcome1234567", clock)).toEqual({ ok: true, personId: person.id, email: "bea@example.test" });
    expect(await checkoutSignIn(w.store, "cs_test_unknown1234567", clock)).toEqual({ ok: false, reason: "pending" });
    const one = await issueWelcomeToken(w.store, person, "checkout", "cs_test_welcome1234567", clock);
    const two = await issueWelcomeToken(w.store, person, "checkout", "cs_test_welcome1234567", clock);
    expect((await w.store.redeem(welcomeTokenHash(one), "a".repeat(64), clock)).status).toBe("ok");
    expect(await w.store.redeem(welcomeTokenHash(two), "b".repeat(64), clock)).toEqual({ status: "session_used" });
    expect(await checkoutSignIn(w.store, "cs_test_welcome1234567", clock)).toEqual({ ok: false, reason: "linked" });
    person.chat_account_id = null;
    expect(await checkoutSignIn(w.store, "cs_test_welcome1234567", clock)).toEqual({ ok: false, reason: "session_used" });
  });
  it("not after 2 hours", async () => {
    await buyer("old@example.test", 2 * 60 * 60 * 1000 + 1000, "cs_test_oldsession12345");
    expect(await checkoutSignIn(w.store, "cs_test_oldsession12345", clock)).toEqual({ ok: false, reason: "too_old" });
  });
  it("not for a Longboard account's email", async () => {
    await buyer("lb@example.test", 1000, "cs_test_lbsession123456");
    w.longboard.add("lb@example.test");
    expect(await checkoutSignIn(w.store, "cs_test_lbsession123456", clock)).toEqual({ ok: false, reason: "longboard_account" });
  });
});
