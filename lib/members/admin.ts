import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberEntitlement, MemberPerson, MemberPurchase } from "@/lib/members/types";

/** #384: the admin members list: people with their purchases and entitlements. */
export type AdminMember = MemberPerson & {
  purchases: MemberPurchase[];
  entitlements: (MemberEntitlement & { active: boolean })[];
  activeKeys: string[];
};

export function entitlementActive(row: Pick<MemberEntitlement, "revoked_at" | "starts_at" | "ends_at">, now = Date.now()) {
  return !row.revoked_at && Date.parse(row.starts_at) <= now && (!row.ends_at || Date.parse(row.ends_at) > now);
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listMembers(db: SupabaseClient, query: string, limit = 50): Promise<AdminMember[]> {
  let people = db.from("member_people").select("*").order("created_at", { ascending: false }).limit(limit);
  const q = query.trim().toLowerCase().slice(0, 120);
  if (q) people = people.ilike("email", like(q));
  const { data, error } = await people;
  if (error) throw new Error("members_unavailable");
  const rows = (data ?? []) as MemberPerson[];
  if (!rows.length) return [];
  const ids = rows.map((p) => p.id);
  const [purchases, entitlements] = await Promise.all([
    db.from("member_purchases").select("*").in("person_id", ids).order("created_at", { ascending: false }),
    db.from("member_entitlements").select("*").in("person_id", ids).order("created_at", { ascending: false }),
  ]);
  if (purchases.error || entitlements.error) throw new Error("members_unavailable");
  const now = Date.now();
  return rows.map((person) => {
    const mine = ((entitlements.data ?? []) as MemberEntitlement[])
      .filter((e) => e.person_id === person.id)
      .map((e) => ({ ...e, active: entitlementActive(e, now) }));
    return {
      ...person,
      purchases: ((purchases.data ?? []) as MemberPurchase[]).filter((p) => p.person_id === person.id),
      entitlements: mine,
      activeKeys: [...new Set(mine.filter((e) => e.active).map((e) => e.entitlement_key))].sort(),
    };
  });
}

/** Every entitlement key a product unlocks, for the grant menu. */
export async function knownEntitlementKeys(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("member_product_entitlements").select("entitlement_key");
  if (error) throw new Error("members_unavailable");
  return [...new Set(((data ?? []) as { entitlement_key: string }[]).map((r) => r.entitlement_key))].sort();
}
