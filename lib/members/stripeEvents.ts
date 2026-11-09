import { isEntitlementKey, normalizeEmail } from "@/lib/memberAccess";
import type { MemberProduct, MemberPurchase, MemberStore, StripeEventRecord } from "@/lib/members/types";

/**
 * #384: what each Stripe event does to the members tables. Pure logic over a MemberStore and a
 * small StripeApi, so the tests run it on memory with Stripe's own signed test events.
 *
 * Events (enable exactly these on the webhook endpoint):
 *   checkout.session.completed, checkout.session.async_payment_succeeded
 *     -> the buyer (by email) and the purchase; entitlements when paid.
 *   customer.subscription.created / updated / deleted
 *     -> status and billing period; access follows them.
 *   invoice.paid            -> a renewal: the period moves on, access is extended.
 *   invoice.payment_failed  -> past_due: access stays until the period end + grace, while Stripe
 *                              retries; if Stripe finally cancels, subscription.deleted ends it.
 *   charge.refunded         -> a full refund ends the purchase's access; a partial one is recorded.
 * Anything else is recorded and ignored.
 *
 * Access rules (syncEntitlements):
 *   subscription: active, trialing or past_due -> granted until current_period_end + 3 days
 *     (just current_period_end once it's set to cancel then). Anything else -> revoked.
 *   one-time: paid -> granted with no end (or access_days from the product).
 *   refunded in full -> revoked.
 * An entitlement an admin revoked by hand stays revoked whatever Stripe says later.
 */

export const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const ACTIVE_SUBSCRIPTION = new Set(["active", "trialing", "past_due"]);

export type StripeLike = { id: string; type: string; livemode?: boolean; created: number; data: { object: unknown } };

/** The few Stripe reads the handler may need; null in the app when STRIPE_SECRET_KEY is unset. */
export interface StripeApi {
  /** Price and product ids of a Checkout Session's line items. */
  lineItems(sessionId: string): Promise<{ priceId: string | null; productId: string | null }[]>;
  subscription(id: string): Promise<Record<string, unknown> | null>;
  customerEmail(id: string): Promise<{ email: string | null; name: string | null } | null>;
  /** The subscription an invoice payment (by payment intent) belongs to. */
  subscriptionForPaymentIntent(paymentIntentId: string): Promise<string | null>;
}

export type HandleResult = { status: "processed" | "duplicate" | "ignored"; outcome: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** An expandable field: an id string or an object with an id. */
const idOf = (v: unknown): string | null => str(v) ?? str(obj(v).id);
const time = (seconds: unknown): string | null => {
  const n = num(seconds);
  return n === null ? null : new Date(n * 1000).toISOString();
};
const sameTime = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

type Deps = {
  store: MemberStore;
  api: StripeApi | null;
  now?: () => Date;
  productMap?: Map<string, string>;
  /** #390: filled with the people this event gave access for the first time (new entitlement rows), to welcome. */
  granted?: Set<string>;
};

/** STRIPE_PRODUCT_MAP="price_123:booker-stock-club,prod_456:booker-stock-club" (table rows work too). */
export function parseProductMap(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (value ?? "").split(/[\s,]+/)) {
    const [id, key] = pair.split(/[:=]/);
    if (id && key && /^(price|prod|plink)_[A-Za-z0-9]+$/.test(id) && isEntitlementKey(key)) map.set(id, key);
  }
  return map;
}

export async function handleStripeEvent(event: StripeLike, deps: Deps): Promise<HandleResult> {
  const { store } = deps;
  const object = obj(event.data?.object);
  const record: StripeEventRecord = {
    id: event.id,
    type: event.type,
    livemode: event.livemode === true,
    created: new Date(event.created * 1000),
    objectId: str(object.id),
  };
  if ((await store.claimEvent(record)) === "duplicate") return { status: "duplicate", outcome: "already_processed" };
  try {
    const outcome = await route(event, object, deps);
    await store.finishEvent(event.id, { outcome });
    return { status: outcome === "ignored" ? "ignored" : "processed", outcome };
  } catch (error) {
    await store.finishEvent(event.id, { error: error instanceof Error ? error.message.slice(0, 500) : "failed" }).catch(() => {});
    throw error;
  }
}

async function route(event: StripeLike, object: Obj, deps: Deps): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return checkoutCompleted(event, object, deps);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return subscriptionChanged(event, object, deps);
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return invoicePaid(event, object, deps);
    case "invoice.payment_failed":
      return invoiceFailed(event, object, deps);
    case "charge.refunded":
      return chargeRefunded(event, object, deps);
    default:
      return "ignored";
  }
}

const addEvent = (purchase: MemberPurchase | null, id: string) =>
  [...(purchase?.event_ids ?? []).filter((e) => e !== id), id].slice(-50);

async function resolveProduct(deps: Deps, metadata: unknown, ids: (string | null)[]): Promise<string | null> {
  const wanted = str(obj(metadata).lb_product);
  if (wanted && isEntitlementKey(wanted) && (await deps.store.product(wanted))) return wanted;
  const list = ids.filter((id): id is string => !!id);
  for (const id of list) {
    const key = deps.productMap?.get(id);
    if (key) return key;
  }
  return list.length ? deps.store.productForStripeIds(list) : null;
}

/** Subscription fields across API versions (the period moved onto the items in 2025). */
function subscriptionFields(sub: Obj, deleted = false) {
  const item = obj((obj(sub.items).data as unknown[] | undefined)?.[0]);
  const price = obj(item.price);
  const status = deleted ? "canceled" : (str(sub.status) ?? "incomplete");
  return {
    status,
    current_period_start: time(sub.current_period_start ?? item.current_period_start),
    current_period_end: time(sub.current_period_end ?? item.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end === true,
    canceled: status === "canceled",
    canceled_at: time(sub.canceled_at ?? sub.ended_at),
    stripe_price_id: str(price.id),
    stripe_product_id: idOf(price.product),
    amount: num(price.unit_amount),
    currency: str(price.currency) ?? str(sub.currency),
  };
}

function blankPurchase(personId: string, kind: MemberPurchase["kind"], livemode: boolean): Omit<MemberPurchase, "id" | "created_at" | "updated_at"> {
  return {
    person_id: personId,
    product_key: null,
    kind,
    status: kind === "subscription" ? "incomplete" : "unpaid",
    stripe_customer_id: null,
    stripe_checkout_session_id: null,
    stripe_subscription_id: null,
    stripe_payment_intent_id: null,
    stripe_invoice_id: null,
    stripe_price_id: null,
    stripe_product_id: null,
    amount: null,
    currency: null,
    livemode,
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    canceled: false,
    canceled_at: null,
    refunded: false,
    refunded_amount: 0,
    last_event_at: null,
    event_ids: [],
  };
}

async function save(deps: Deps, existing: MemberPurchase | null, fields: Partial<MemberPurchase>, personId: string, kind: MemberPurchase["kind"], livemode: boolean) {
  return existing
    ? deps.store.updatePurchase(existing.id, fields)
    : deps.store.insertPurchase({ ...blankPurchase(personId, kind, livemode), ...fields } as Omit<MemberPurchase, "id" | "created_at" | "updated_at">);
}

async function checkoutCompleted(event: StripeLike, s: Obj, deps: Deps): Promise<string> {
  const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";
  if (!paid) return "awaiting_payment";
  const details = obj(s.customer_details);
  const customer = idOf(s.customer);
  let email = normalizeEmail(details.email) ?? normalizeEmail(s.customer_email);
  let name = str(details.name);
  if (!email && customer && deps.api) {
    const found = await deps.api.customerEmail(customer);
    email = normalizeEmail(found?.email);
    name ??= found?.name ?? null;
  }
  if (!email) return "no_email";
  const person = await deps.store.upsertPerson(email, { name, stripe_customer_id: customer });
  const kind: MemberPurchase["kind"] = s.mode === "subscription" ? "subscription" : "one_time";
  const sessionId = str(s.id)!;
  const subscriptionId = idOf(s.subscription);
  const existing =
    (await deps.store.purchaseBy("stripe_checkout_session_id", sessionId)) ??
    (subscriptionId ? await deps.store.purchaseBy("stripe_subscription_id", subscriptionId) : null);
  const items = deps.api ? await deps.api.lineItems(sessionId).catch(() => []) : [];
  const first = items[0] ?? { priceId: null, productId: null };
  const productKey =
    existing?.product_key ??
    (await resolveProduct(deps, s.metadata, [first.priceId, first.productId, idOf(s.payment_link), ...items.flatMap((i) => [i.priceId, i.productId])]));
  const fields: Partial<MemberPurchase> = {
    person_id: person.id,
    product_key: productKey,
    stripe_customer_id: customer ?? existing?.stripe_customer_id ?? null,
    stripe_checkout_session_id: sessionId,
    stripe_subscription_id: subscriptionId ?? existing?.stripe_subscription_id ?? null,
    stripe_payment_intent_id: idOf(s.payment_intent) ?? existing?.stripe_payment_intent_id ?? null,
    stripe_invoice_id: idOf(s.invoice) ?? existing?.stripe_invoice_id ?? null,
    stripe_price_id: first.priceId ?? existing?.stripe_price_id ?? null,
    stripe_product_id: first.productId ?? existing?.stripe_product_id ?? null,
    amount: num(s.amount_total) ?? existing?.amount ?? null,
    currency: str(s.currency) ?? existing?.currency ?? null,
    event_ids: addEvent(existing, event.id),
  };
  if (kind === "one_time") {
    if (!existing?.refunded) fields.status = "paid";
  } else if (!existing || existing.status === "incomplete") {
    // The subscription's own events carry its status and period; until one arrives, read it.
    const sub = subscriptionId && deps.api ? await deps.api.subscription(subscriptionId).catch(() => null) : null;
    if (sub) {
      const { stripe_price_id, stripe_product_id, amount, currency, ...state } = subscriptionFields(sub);
      Object.assign(fields, state, {
        stripe_price_id: fields.stripe_price_id ?? stripe_price_id,
        stripe_product_id: fields.stripe_product_id ?? stripe_product_id,
        amount: fields.amount ?? amount,
        currency: fields.currency ?? currency,
      });
    } else fields.status = "active"; // paid checkout; the subscription events will correct it
  }
  const purchase = await save(deps, existing, fields, person.id, kind, event.livemode === true);
  return syncEntitlements(deps, purchase);
}

/** The purchase row for a subscription, made from Stripe when its checkout hasn't arrived yet. */
async function subscriptionPurchase(deps: Deps, subscriptionId: string, customer: string | null, livemode: boolean) {
  const existing = await deps.store.purchaseBy("stripe_subscription_id", subscriptionId);
  if (existing) return { existing, personId: existing.person_id };
  let person = customer ? await deps.store.personByCustomer(customer) : null;
  if (!person && customer && deps.api) {
    const found = await deps.api.customerEmail(customer);
    const email = normalizeEmail(found?.email);
    if (email) person = await deps.store.upsertPerson(email, { name: found?.name ?? null, stripe_customer_id: customer });
  }
  return person ? { existing: null, personId: person.id, livemode } : null;
}

async function subscriptionChanged(event: StripeLike, sub: Obj, deps: Deps): Promise<string> {
  const subscriptionId = str(sub.id)!;
  const customer = idOf(sub.customer);
  const found = await subscriptionPurchase(deps, subscriptionId, customer, event.livemode === true);
  // No buyer known yet (no checkout, no customer email): the checkout event will read it.
  if (!found) return "waiting_for_checkout";
  const { existing, personId } = found;
  const eventAt = new Date(event.created * 1000).toISOString();
  if (existing?.last_event_at && Date.parse(existing.last_event_at) > Date.parse(eventAt)) return "stale";
  const state = subscriptionFields(sub, event.type === "customer.subscription.deleted");
  const productKey = existing?.product_key ?? (await resolveProduct(deps, sub.metadata, [state.stripe_price_id, state.stripe_product_id]));
  const purchase = await save(
    deps,
    existing,
    {
      ...state,
      // A refund already ended access; a later subscription event doesn't undo that.
      ...(existing?.refunded ? { status: existing.status } : {}),
      amount: state.amount ?? existing?.amount ?? null,
      product_key: productKey,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customer ?? existing?.stripe_customer_id ?? null,
      last_event_at: eventAt,
      event_ids: addEvent(existing, event.id),
    },
    personId,
    "subscription",
    event.livemode === true,
  );
  return syncEntitlements(deps, purchase);
}

function invoiceSubscription(inv: Obj): string | null {
  return idOf(inv.subscription) ?? idOf(obj(obj(inv.parent).subscription_details).subscription);
}

function invoicePeriodEnd(inv: Obj): string | null {
  let end: string | null = null;
  for (const line of (obj(inv.lines).data as unknown[] | undefined) ?? []) end = later(end, time(obj(obj(line).period).end));
  return end;
}

async function invoicePaid(event: StripeLike, inv: Obj, deps: Deps): Promise<string> {
  const subscriptionId = invoiceSubscription(inv);
  if (!subscriptionId) return "not_a_subscription";
  let found = await subscriptionPurchase(deps, subscriptionId, idOf(inv.customer), event.livemode === true);
  if (!found) return "waiting_for_checkout";
  if (!found.existing) {
    // Make the row from the subscription itself, then apply the payment.
    const sub = deps.api ? await deps.api.subscription(subscriptionId).catch(() => null) : null;
    if (!sub) return "waiting_for_checkout";
    await subscriptionChanged({ ...event, type: "customer.subscription.updated", data: { object: sub } }, sub, deps);
    found = await subscriptionPurchase(deps, subscriptionId, idOf(inv.customer), event.livemode === true);
    if (!found?.existing) return "waiting_for_checkout";
  }
  const existing = found.existing!;
  const periodEnd = later(existing.current_period_end, invoicePeriodEnd(inv));
  const purchase = await deps.store.updatePurchase(existing.id, {
    status: existing.canceled || existing.refunded ? existing.status : "active",
    current_period_end: periodEnd,
    stripe_invoice_id: str(inv.id),
    stripe_payment_intent_id: idOf(inv.payment_intent) ?? existing.stripe_payment_intent_id,
    amount: num(inv.amount_paid) ?? existing.amount,
    currency: str(inv.currency) ?? existing.currency,
    event_ids: addEvent(existing, event.id),
  });
  return syncEntitlements(deps, purchase);
}

async function invoiceFailed(event: StripeLike, inv: Obj, deps: Deps): Promise<string> {
  const subscriptionId = invoiceSubscription(inv);
  if (!subscriptionId) return "not_a_subscription";
  const existing = await deps.store.purchaseBy("stripe_subscription_id", subscriptionId);
  if (!existing) return "waiting_for_checkout";
  const purchase = await deps.store.updatePurchase(existing.id, {
    status: existing.canceled || existing.refunded ? existing.status : "past_due",
    stripe_invoice_id: str(inv.id),
    event_ids: addEvent(existing, event.id),
  });
  return syncEntitlements(deps, purchase);
}

async function chargeRefunded(event: StripeLike, ch: Obj, deps: Deps): Promise<string> {
  const paymentIntent = idOf(ch.payment_intent);
  const invoice = idOf(ch.invoice);
  let purchase =
    (paymentIntent ? await deps.store.purchaseBy("stripe_payment_intent_id", paymentIntent) : null) ??
    (invoice ? await deps.store.purchaseBy("stripe_invoice_id", invoice) : null);
  if (!purchase && paymentIntent && deps.api) {
    const subscriptionId = await deps.api.subscriptionForPaymentIntent(paymentIntent).catch(() => null);
    if (subscriptionId) purchase = await deps.store.purchaseBy("stripe_subscription_id", subscriptionId);
  }
  if (!purchase) return "unknown_purchase";
  const amount = num(ch.amount) ?? 0;
  const refundedAmount = num(ch.amount_refunded) ?? 0;
  const full = ch.refunded === true || (amount > 0 && refundedAmount >= amount);
  const updated = await deps.store.updatePurchase(purchase.id, {
    refunded: purchase.refunded || full,
    refunded_amount: Math.max(purchase.refunded_amount ?? 0, refundedAmount),
    status: full && purchase.kind === "one_time" ? "refunded" : purchase.status,
    event_ids: addEvent(purchase, event.id),
  });
  return full ? syncEntitlements(deps, updated) : "partial_refund";
}

/** Whether a purchase gives access now, and until when. */
export function purchaseAccess(purchase: MemberPurchase, product: Pick<MemberProduct, "access_days">, now: Date): { active: boolean; endsAt: string | null; reason: string } {
  if (purchase.refunded) return { active: false, endsAt: null, reason: "refunded" };
  if (purchase.kind === "one_time") {
    if (purchase.status !== "paid") return { active: false, endsAt: null, reason: `payment_${purchase.status}` };
    const endsAt = product.access_days ? new Date(Date.parse(purchase.created_at) + product.access_days * 86400000).toISOString() : null;
    return { active: true, endsAt, reason: "paid" };
  }
  if (!ACTIVE_SUBSCRIPTION.has(purchase.status)) return { active: false, endsAt: null, reason: `subscription_${purchase.status}` };
  const periodEnd = purchase.current_period_end ? Date.parse(purchase.current_period_end) : null;
  const endsAt =
    periodEnd === null
      ? new Date(now.getTime() + GRACE_MS) // provisional until the subscription's period arrives
      : new Date(purchase.cancel_at_period_end ? periodEnd : periodEnd + GRACE_MS);
  return { active: true, endsAt: endsAt.toISOString(), reason: purchase.status };
}

/** Make the purchase's entitlement rows match its state. Returns the handler's outcome. */
export async function syncEntitlements(deps: Deps, purchase: MemberPurchase): Promise<string> {
  if (!purchase.product_key) return "unmapped_product";
  const product = await deps.store.product(purchase.product_key);
  if (!product) return "unknown_product";
  const now = deps.now?.() ?? new Date();
  const access = purchaseAccess(purchase, product, now);
  const rows = await deps.store.purchaseEntitlements(purchase.id);
  if (!access.active) {
    for (const row of rows.filter((r) => !r.revoked_at))
      await deps.store.updateEntitlement(row.id, { revoked_at: now.toISOString(), revoked_by: "stripe", revoked_reason: access.reason });
    return `revoked:${access.reason}`;
  }
  let inserted = false;
  for (const key of product.entitlements) {
    const row = rows.find((r) => r.entitlement_key === key);
    if (!row) {
      inserted = true;
      await deps.store.insertEntitlement({
        person_id: purchase.person_id,
        entitlement_key: key,
        product_key: product.key,
        purchase_id: purchase.id,
        starts_at: now.toISOString(),
        ends_at: access.endsAt,
        granted_by: "stripe",
        granted_by_user: null,
        note: null,
        revoked_at: null,
        revoked_by: null,
        revoked_by_user: null,
        revoked_reason: null,
      });
    } else if (row.revoked_by === "admin") {
      continue; // an admin's revoke stands
    } else if (!sameTime(row.ends_at, access.endsAt) || row.revoked_at) {
      await deps.store.updateEntitlement(row.id, { ends_at: access.endsAt, revoked_at: null, revoked_by: null, revoked_reason: null });
    }
  }
  // A renewal, a resend or a late event only moves existing rows; a new row is a first grant.
  if (inserted) deps.granted?.add(purchase.person_id);
  return `granted:${access.reason}`;
}
