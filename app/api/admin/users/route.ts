import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminUser = {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string;
  last_sign_in_at: string | null;
};

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Pull profiles (fast) and auth.users (needs admin API) separately, join by id.
  const [{ data: profiles, error: profilesErr }, { data: authData, error: authErr }] = await Promise.all([
    admin.from("profiles").select("id, email, role, created_at"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesErr) {
    return NextResponse.json({ error: "profiles_fetch_failed", message: profilesErr.message }, { status: 500 });
  }
  if (authErr) {
    return NextResponse.json({ error: "auth_fetch_failed", message: authErr.message }, { status: 500 });
  }

  const signInById = new Map<string, string | null>();
  for (const u of authData.users) {
    signInById.set(u.id, u.last_sign_in_at ?? null);
  }

  const users: AdminUser[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    role: p.role === "admin" ? "admin" : "user",
    created_at: p.created_at,
    last_sign_in_at: signInById.get(p.id) ?? null,
  }));

  users.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return NextResponse.json({ users });
}
