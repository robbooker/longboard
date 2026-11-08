import { randomUUID } from "node:crypto";
import type { MemberEntitlement, MemberPerson, MemberProduct, MemberPurchase, MemberStore } from "@/lib/members/types";

/** #384 tests: the members tables in memory, with the same uniqueness rules as the migration. */
export function memoryMemberStore() {
  const events = new Map<string, { type: string; processed: boolean; error?: string; outcome?: string; attempts: number }>();
  const people: MemberPerson[] = [];
  const purchases: MemberPurchase[] = [];
  const entitlements: MemberEntitlement[] = [];
  const products = new Map<string, MemberProduct>([
    ["booker-stock-club", { key: "booker-stock-club", name: "Booker Stock Club", access_days: null, active: true, entitlements: ["club-room", "gainers", "reader"] }],
    ["one-month-pass", { key: "one-month-pass", name: "One month", access_days: 30, active: true, entitlements: ["gainers"] }],
  ]);
  const stripeIds = new Map<string, string>([["price_club_monthly", "booker-stock-club"], ["price_month_pass", "one-month-pass"]]);
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 1) + ++clock * 1000).toISOString();
  const store: MemberStore & { failNext?: string } = {
    async claimEvent(e) {
      const row = events.get(e.id);
      if (row?.processed) return "duplicate";
      if (row) row.attempts++;
      else events.set(e.id, { type: e.type, processed: false, attempts: 1 });
      return "new";
    },
    async finishEvent(id, result) {
      const row = events.get(id)!;
      if (result.error) row.error = result.error;
      else Object.assign(row, { processed: true, outcome: result.outcome, error: undefined });
    },
    async personByEmail(email) {
      return people.find((p) => p.email === email) ?? null;
    },
    async personByCustomer(id) {
      return people.find((p) => p.stripe_customer_id === id) ?? null;
    },
    async upsertPerson(email, fields) {
      let person = people.find((p) => p.email === email);
      if (!person) {
        person = { id: randomUUID(), email, name: fields.name ?? null, stripe_customer_id: fields.stripe_customer_id ?? null, chat_account_id: null };
        people.push(person);
      } else {
        if (fields.name && !person.name) person.name = fields.name;
        if (fields.stripe_customer_id) person.stripe_customer_id = fields.stripe_customer_id;
      }
      return { ...person };
    },
    async purchaseBy(field, value) {
      const row = [...purchases].reverse().find((p) => p[field] === value);
      return row ? { ...row } : null;
    },
    async insertPurchase(row) {
      if (store.failNext === "insertPurchase") {
        store.failNext = undefined;
        throw new Error("purchase_insert: connection reset");
      }
      for (const key of ["stripe_checkout_session_id", "stripe_subscription_id"] as const)
        if (row[key] && purchases.some((p) => p[key] === row[key])) throw new Error(`duplicate ${key}`);
      const made = { ...row, id: randomUUID(), created_at: stamp() } as MemberPurchase;
      purchases.push(made);
      return { ...made };
    },
    async updatePurchase(id, patch) {
      const row = purchases.find((p) => p.id === id)!;
      Object.assign(row, patch);
      return { ...row };
    },
    async productForStripeIds(ids) {
      for (const id of ids) if (stripeIds.has(id)) return stripeIds.get(id)!;
      return null;
    },
    async product(key) {
      return products.get(key) ?? null;
    },
    async purchaseEntitlements(purchaseId) {
      return entitlements.filter((e) => e.purchase_id === purchaseId).map((e) => ({ ...e }));
    },
    async insertEntitlement(row) {
      if (row.purchase_id && entitlements.some((e) => e.purchase_id === row.purchase_id && e.entitlement_key === row.entitlement_key))
        throw new Error("duplicate entitlement");
      const made = { ...row, id: randomUUID() } as MemberEntitlement;
      entitlements.push(made);
      return { ...made };
    },
    async updateEntitlement(id, patch) {
      Object.assign(entitlements.find((e) => e.id === id)!, patch);
    },
  };
  /** Active keys of an email at a moment, the way member_email_entitlements decides. */
  const activeKeys = (email: string, at = new Date()) => {
    const person = people.find((p) => p.email === email);
    if (!person) return [];
    return [
      ...new Set(
        entitlements
          .filter((e) => e.person_id === person.id && !e.revoked_at && Date.parse(e.starts_at) <= at.getTime() && (!e.ends_at || Date.parse(e.ends_at) > at.getTime()))
          .map((e) => e.entitlement_key),
      ),
    ].sort();
  };
  return { store, events, people, purchases, entitlements, products, stripeIds, activeKeys };
}
