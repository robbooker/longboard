import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type AuthedUser = { id: string; email: string; role: "user" | "admin" };
export type AuthResult = { ok: true; user: AuthedUser } | { ok: false; status: 401 | 403; error: string };

/** Reads the Supabase session from cookies, then fetches the matching profiles
 *  row. RLS on profiles limits the SELECT to the user's own row, which is
 *  exactly what we want. */
export async function getCurrentUser(_req?: NextRequest): Promise<AuthResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    return { ok: false, status: 401, error: "unauthenticated" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return { ok: false, status: 403, error: "no_profile" };
  }

  const role: "user" | "admin" = profile.role === "admin" ? "admin" : "user";
  return { ok: true, user: { id: profile.id, email: profile.email, role } };
}

/** Gate for any route a logged-in user can hit. */
export async function requireUser(req: NextRequest): Promise<AuthResult> {
  return getCurrentUser(req);
}

/** Gate for admin-only routes. */
export async function requireAdmin(req: NextRequest): Promise<AuthResult> {
  const result = await getCurrentUser(req);
  if (!result.ok) return result;
  if (result.user.role !== "admin") {
    return { ok: false, status: 403, error: "admin_only" };
  }
  return result;
}
