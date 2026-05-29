import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createArenaAgent, listArenaAdminAgents } from "@/lib/arena/agents-store";
import { getProviderDef, isArenaProviderKey, isValidAgentSlug, slugFromDisplayName } from "@/lib/arena/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/arena/agents — list agents + draft/published config */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const includeArchived = req.nextUrl.searchParams.get("archived") === "1";
  const agents = await listArenaAdminAgents(includeArchived);
  return NextResponse.json({ agents });
}

/** POST /api/admin/arena/agents — create a new agent */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: {
    slug?: unknown;
    displayName?: unknown;
    providerKey?: unknown;
    modelId?: unknown;
    modelFamily?: unknown;
    avatarColor?: unknown;
    bio?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) return NextResponse.json({ error: "display_name_required" }, { status: 400 });

  const slug =
    typeof body.slug === "string" && body.slug.trim()
      ? body.slug.trim().toLowerCase()
      : slugFromDisplayName(displayName);

  if (!isValidAgentSlug(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const providerKey = typeof body.providerKey === "string" ? body.providerKey : "";
  if (!isArenaProviderKey(providerKey)) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }

  const providerDef = getProviderDef(providerKey)!;
  const modelId =
    typeof body.modelId === "string" && body.modelId.trim()
      ? body.modelId.trim()
      : providerDef.defaultModelId;

  const result = await createArenaAgent(
    {
      slug,
      displayName,
      providerKey,
      modelId,
      modelFamily: typeof body.modelFamily === "string" ? body.modelFamily : undefined,
      avatarColor: typeof body.avatarColor === "string" ? body.avatarColor : undefined,
      bio: typeof body.bio === "string" ? body.bio : undefined,
    },
    auth.user.id,
  );

  if (!result.ok) {
    const status =
      result.error === "db_unavailable" ? 503 : result.error === "slug_exists" ? 409 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ agent: result.record }, { status: 201 });
}
