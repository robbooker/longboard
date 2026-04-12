import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Call at the top of protected API route handlers. Returns a 401 Response or null. */
export async function requireAuth(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const allowed = process.env.ALLOWED_EMAILS;
  if (!allowed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const list = allowed.split(",").map((e) => e.trim().toLowerCase());
  if (!list.includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
