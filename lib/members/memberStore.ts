import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberEntitlement, MemberPerson, MemberProduct, MemberPurchase, MemberStore } from "@/lib/members/types";

/** #384: the members tables through the service-role client (RLS on, no client access). */
export function supabaseMemberStore(db: SupabaseClient): MemberStore {
  const fail = (what: string, error: { message?: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message ?? "failed"}`);
  };
  const stamp = () => new Date().toISOString();
  return {
    async claimEvent(event) {
      const { data, error } = await db
        .from("member_stripe_events")
        .upsert(
          {
            event_id: event.id,
            type: event.type,
            livemode: event.livemode,
            stripe_created_at: event.created.toISOString(),
            object_id: event.objectId,
          },
          { onConflict: "event_id", ignoreDuplicates: true },
        )
        .select("event_id");
      fail("event_claim", error);
      if (data?.length) return "new";
      const { data: row, error: readError } = await db
        .from("member_stripe_events")
        .select("event_id,processed_at,attempts")
        .eq("event_id", event.id)
        .maybeSingle();
      fail("event_read", readError);
      if (row?.processed_at) return "duplicate";
      // An earlier delivery failed part way: try again (every write below is an upsert or update).
      await db
        .from("member_stripe_events")
        .update({ attempts: (row?.attempts ?? 1) + 1, error: null })
        .eq("event_id", event.id);
      return "new";
    },
    async finishEvent(id, result) {
      const { error } = await db
        .from("member_stripe_events")
        .update(
          result.error
            ? { error: result.error, outcome: null }
            : { processed_at: stamp(), outcome: result.outcome ?? null, error: null },
        )
        .eq("event_id", id);
      fail("event_finish", error);
    },
    async personByEmail(email) {
      const { data, error } = await db.from("member_people").select("*").eq("email", email).maybeSingle();
      fail("person_read", error);
      return (data as MemberPerson) ?? null;
    },
    async personByCustomer(customerId) {
      const { data, error } = await db
        .from("member_people")
        .select("*")
        .eq("stripe_customer_id", customerId)
        .order("created_at", { ascending: true })
        .limit(1);
      fail("person_read", error);
      return ((data ?? [])[0] as MemberPerson) ?? null;
    },
    async upsertPerson(email, fields) {
      const existing = await this.personByEmail(email);
      if (existing) {
        const patch: Record<string, unknown> = {};
        if (fields.name && !existing.name) patch.name = fields.name;
        if (fields.stripe_customer_id && fields.stripe_customer_id !== existing.stripe_customer_id)
          patch.stripe_customer_id = fields.stripe_customer_id;
        if (!Object.keys(patch).length) return existing;
        const { data, error } = await db
          .from("member_people")
          .update({ ...patch, updated_at: stamp() })
          .eq("id", existing.id)
          .select("*")
          .single();
        fail("person_update", error);
        return data as MemberPerson;
      }
      const { data, error } = await db
        .from("member_people")
        .upsert(
          { email, name: fields.name ?? null, stripe_customer_id: fields.stripe_customer_id ?? null },
          { onConflict: "email", ignoreDuplicates: true },
        )
        .select("*");
      fail("person_insert", error);
      // Lost a race with another event for the same buyer: read theirs.
      return ((data ?? [])[0] as MemberPerson) ?? (await this.personByEmail(email))!;
    },
    async purchaseBy(field, value) {
      const { data, error } = await db
        .from("member_purchases")
        .select("*")
        .eq(field, value)
        .order("created_at", { ascending: false })
        .limit(1);
      fail("purchase_read", error);
      return ((data ?? [])[0] as MemberPurchase) ?? null;
    },
    async insertPurchase(row) {
      const { data, error } = await db.from("member_purchases").insert(row).select("*").single();
      fail("purchase_insert", error);
      return data as MemberPurchase;
    },
    async updatePurchase(id, patch) {
      const { data, error } = await db
        .from("member_purchases")
        .update({ ...patch, updated_at: stamp() })
        .eq("id", id)
        .select("*")
        .single();
      fail("purchase_update", error);
      return data as MemberPurchase;
    },
    async productForStripeIds(ids) {
      if (!ids.length) return null;
      const { data, error } = await db
        .from("member_product_stripe_ids")
        .select("stripe_id,product_key")
        .in("stripe_id", ids);
      fail("product_map_read", error);
      const rows = (data ?? []) as { stripe_id: string; product_key: string }[];
      for (const id of ids) {
        const row = rows.find((r) => r.stripe_id === id);
        if (row) return row.product_key;
      }
      return null;
    },
    async product(key) {
      const [{ data, error }, { data: keys, error: keysError }] = await Promise.all([
        db.from("member_products").select("key,name,access_days,active").eq("key", key).maybeSingle(),
        db.from("member_product_entitlements").select("entitlement_key").eq("product_key", key),
      ]);
      fail("product_read", error ?? keysError);
      if (!data) return null;
      return {
        ...(data as Omit<MemberProduct, "entitlements">),
        entitlements: ((keys ?? []) as { entitlement_key: string }[]).map((r) => r.entitlement_key).sort(),
      };
    },
    async purchaseEntitlements(purchaseId) {
      const { data, error } = await db.from("member_entitlements").select("*").eq("purchase_id", purchaseId);
      fail("entitlement_read", error);
      return (data ?? []) as MemberEntitlement[];
    },
    async insertEntitlement(row) {
      const { data, error } = await db.from("member_entitlements").insert(row).select("*").single();
      fail("entitlement_insert", error);
      return data as MemberEntitlement;
    },
    async updateEntitlement(id, patch) {
      const { error } = await db
        .from("member_entitlements")
        .update({ ...patch, updated_at: stamp() })
        .eq("id", id);
      fail("entitlement_update", error);
    },
  };
}
