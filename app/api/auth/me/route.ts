import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns { id, email, role } for the current user, or 401 if not signed in.
 *  Used by DashboardNav to decide whether to render the Admin link. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(auth.user);
}
