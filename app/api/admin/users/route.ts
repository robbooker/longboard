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
  banned_until: string | null;
  tags: string[];
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

  // Pull profiles, auth.users, and user_tags in parallel and join by id.
  const [
    { data: profiles, error: profilesErr },
    { data: authData, error: authErr },
    { data: tagRows, error: tagsErr },
  ] = await Promise.all([
    admin.from("profiles").select("id, email, role, created_at"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("user_tags").select("user_id, tag"),
  ]);

  if (profilesErr) {
    return NextResponse.json({ error: "profiles_fetch_failed", message: profilesErr.message }, { status: 500 });
  }
  if (authErr) {
    return NextResponse.json({ error: "auth_fetch_failed", message: authErr.message }, { status: 500 });
  }
  if (tagsErr) {
    return NextResponse.json({ error: "tags_fetch_failed", message: tagsErr.message }, { status: 500 });
  }

  const authById = new Map<string, { last_sign_in_at: string | null; banned_until: string | null }>();
  for (const u of authData.users) {
    authById.set(u.id, {
      last_sign_in_at: u.last_sign_in_at ?? null,
      banned_until: u.banned_until ?? null,
    });
  }

  const tagsById = new Map<string, string[]>();
  for (const t of tagRows ?? []) {
    const list = tagsById.get(t.user_id) ?? [];
    list.push(t.tag);
    tagsById.set(t.user_id, list);
  }

  const users: AdminUser[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    role: p.role === "admin" ? "admin" : "user",
    created_at: p.created_at,
    last_sign_in_at: authById.get(p.id)?.last_sign_in_at ?? null,
    banned_until: authById.get(p.id)?.banned_until ?? null,
    tags: (tagsById.get(p.id) ?? []).sort(),
  }));

  users.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return NextResponse.json({ users });
}
