/** #384: rows of the members tables (supabase/migrations/20261109100000_members_stripe.sql). */
export type MemberPerson = {
  id: string;
  email: string;
  name: string | null;
  stripe_customer_id: string | null;
  chat_account_id: string | null;
  linked_at?: string | null;
  created_at?: string;
};

export type MemberPurchase = {
  id: string;
  person_id: string;
  product_key: string | null;
  kind: "subscription" | "one_time";
  status: string;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_subscription_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  amount: number | null;
  currency: string | null;
  livemode: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled: boolean;
  canceled_at: string | null;
  refunded: boolean;
  refunded_amount: number;
  last_event_at: string | null;
  event_ids: string[];
  created_at: string;
  updated_at?: string;
};

export type MemberEntitlement = {
  id: string;
  person_id: string;
  entitlement_key: string;
  product_key: string | null;
  purchase_id: string | null;
  starts_at: string;
  ends_at: string | null;
  granted_by: "stripe" | "admin";
  granted_by_user: string | null;
  note: string | null;
  revoked_at: string | null;
  revoked_by: "stripe" | "admin" | null;
  revoked_by_user: string | null;
  revoked_reason: string | null;
  created_at?: string;
};

export type MemberProduct = { key: string; name: string; access_days: number | null; active: boolean; entitlements: string[] };

export type PurchaseLookup = "stripe_checkout_session_id" | "stripe_subscription_id" | "stripe_payment_intent_id" | "stripe_invoice_id";

export type StripeEventRecord = { id: string; type: string; livemode: boolean; created: Date; objectId: string | null };

/** Everything the Stripe event handler reads or writes. Supabase in the app, memory in tests. */
export interface MemberStore {
  /** "new" the first time (or when an earlier try failed), "duplicate" once it was processed. */
  claimEvent(event: StripeEventRecord): Promise<"new" | "duplicate">;
  finishEvent(id: string, result: { outcome?: string; error?: string }): Promise<void>;
  personByEmail(email: string): Promise<MemberPerson | null>;
  personByCustomer(customerId: string): Promise<MemberPerson | null>;
  /** Insert or update by email; a name or customer id fills in when given. */
  upsertPerson(email: string, fields: { name?: string | null; stripe_customer_id?: string | null }): Promise<MemberPerson>;
  purchaseBy(field: PurchaseLookup, value: string): Promise<MemberPurchase | null>;
  insertPurchase(row: Omit<MemberPurchase, "id" | "created_at" | "updated_at">): Promise<MemberPurchase>;
  updatePurchase(id: string, patch: Partial<MemberPurchase>): Promise<MemberPurchase>;
  /** Our product key for the first of these Stripe ids (price_, prod_, plink_) that is mapped. */
  productForStripeIds(ids: string[]): Promise<string | null>;
  product(key: string): Promise<MemberProduct | null>;
  purchaseEntitlements(purchaseId: string): Promise<MemberEntitlement[]>;
  insertEntitlement(row: Omit<MemberEntitlement, "id" | "created_at">): Promise<MemberEntitlement>;
  updateEntitlement(id: string, patch: Partial<MemberEntitlement>): Promise<void>;
}
