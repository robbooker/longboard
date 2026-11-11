import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAuthResult } from "@/lib/chatAuth";

/**
 * #444: whether a member whose Longboard account is linked to a ShortScout membership still has a
 * separate ShortScout chat profile. "separate": the ShortScout account has its own profile (the
 * "Open original ShortScout profile" switch applies). "merged": it has none (the two profiles were
 * merged into this one, or it never had one), so there is one profile and only the membership
 * settings remain. null: no linked membership. A failed read answers "separate", as before #444.
 */
export type ShortScoutProfileState = "separate" | "merged" | null;

export async function shortScoutProfileState(
  admin: SupabaseClient | null,
  auth: ChatAuthResult,
): Promise<ShortScoutProfileState> {
  if (!auth.ok || !auth.hasSeparateShortScoutProfile) return null;
  const source = auth.shortScoutSourceAccountId;
  if (!admin || !source || source === auth.user.id) return "separate";
  try {
    const { data, error } = await admin
      .from("longboard_chat_members")
      .select("id")
      .eq("user_id", source)
      .maybeSingle();
    if (error) return "separate";
    return data ? "separate" : "merged";
  } catch {
    return "separate";
  }
}
