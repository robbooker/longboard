import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side only: never import this verifier into a client component.
// Do not wire into room grants until live profile-level write protection is verified.
const PAID_LEVELS = new Set(["monthly", "annual", "lifetime", "mastermind"]);
export type ShortScoutMembership =
  | { ok: true; subject: string; level: string }
  | { ok: false; reason: "invalid_session" | "not_paid" | "unavailable" };

/** Identity comes exclusively from Supabase Auth, never an email/user ID in a request. */
export async function verifyShortScoutMembership(
  accessToken: string,
  client?: SupabaseClient,
): Promise<ShortScoutMembership> {
  if (!accessToken || accessToken.length > 16384) return { ok: false, reason: "invalid_session" };
  try {
    if (!client) {
      const url = process.env.SHORTSCOUT_SUPABASE_URL;
      const key = process.env.SHORTSCOUT_SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key || new URL(url).hostname !== "xejuximbbpnzqylukrsn.supabase.co" || new URL(url).protocol !== "https:") {
        return { ok: false, reason: "unavailable" };
      }
      client = createClient(url, key, {auth:{persistSession:false,autoRefreshToken:false}});
    }
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user?.id || !data.user.email_confirmed_at) return { ok: false, reason: "invalid_session" };
    const {data:profile,error:profileError} = await client.from("profiles")
      .select("user_id,user_level").eq("user_id",data.user.id).maybeSingle();
    if (profileError) return { ok: false, reason: "unavailable" };
    if (!profile || profile.user_id !== data.user.id || !PAID_LEVELS.has(profile.user_level)) {
      return { ok: false, reason: "not_paid" };
    }
    // Return no email, profile details, credentials or tokens to the caller.
    return { ok:true,subject:data.user.id,level:profile.user_level };
  } catch { return {ok:false,reason:"unavailable"}; }
}
