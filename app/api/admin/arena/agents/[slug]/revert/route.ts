import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isAgentSlug, revertArenaAgentDraft } from "@/lib/arena/agents-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/arena/agents/[slug]/revert — reset draft to last published config */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { slug } = await params;
  if (!isAgentSlug(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const result = await revertArenaAgentDraft(slug, auth.user.id);
  if (!result.ok) {
    const status =
      result.error === "db_unavailable"
        ? 503
        : result.error === "not_found"
          ? 404
          : result.error === "nothing_published"
            ? 409
            : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ agent: result.record });
}
