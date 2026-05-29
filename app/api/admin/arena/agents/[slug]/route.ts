import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  archiveArenaAgent,
  getArenaAdminAgent,
  isAgentSlug,
  saveArenaAgentDraft,
  updateArenaAgentIdentity,
} from "@/lib/arena/agents-store";
import { parseTradeConfig, parseVoiceConfig } from "@/lib/arena/config-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/arena/agents/[slug] */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { slug } = await params;
  if (!isAgentSlug(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const record = await getArenaAdminAgent(slug);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ agent: record });
}

/** PUT /api/admin/arena/agents/[slug] — save draft config and/or identity fields */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { slug } = await params;
  if (!isAgentSlug(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  let body: {
    trade?: unknown;
    voice?: unknown;
    identity?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.identity && typeof body.identity === "object" && !Array.isArray(body.identity)) {
    const id = body.identity as Record<string, unknown>;
    const identityResult = await updateArenaAgentIdentity(
      slug,
      {
        displayName: typeof id.displayName === "string" ? id.displayName : undefined,
        providerKey: typeof id.providerKey === "string" ? id.providerKey : undefined,
        modelId: typeof id.modelId === "string" ? id.modelId : undefined,
        modelFamily: typeof id.modelFamily === "string" ? id.modelFamily : undefined,
        avatarColor: typeof id.avatarColor === "string" ? id.avatarColor : undefined,
        bio: typeof id.bio === "string" ? id.bio : undefined,
        status: id.status === "active" || id.status === "paused" ? id.status : undefined,
        sortOrder: typeof id.sortOrder === "number" ? id.sortOrder : undefined,
      },
      auth.user.id,
    );
    if (!identityResult.ok) {
      const status = identityResult.error === "db_unavailable" ? 503 : 500;
      return NextResponse.json({ error: identityResult.error }, { status });
    }
  }

  if (body.trade !== undefined || body.voice !== undefined) {
    const record = await getArenaAdminAgent(slug);
    if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const trade = parseTradeConfig(body.trade) ?? record.draftTrade;
    const voice = parseVoiceConfig(body.voice) ?? record.draftVoice;
    if (body.trade !== undefined && !parseTradeConfig(body.trade)) {
      return NextResponse.json({ error: "invalid_config" }, { status: 400 });
    }
    if (body.voice !== undefined && !parseVoiceConfig(body.voice)) {
      return NextResponse.json({ error: "invalid_config" }, { status: 400 });
    }

    const result = await saveArenaAgentDraft(slug, trade, voice, auth.user.id);
    if (!result.ok) {
      const status = result.error === "db_unavailable" ? 503 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ agent: result.record });
  }

  const record = await getArenaAdminAgent(slug);
  return NextResponse.json({ agent: record });
}

/** DELETE /api/admin/arena/agents/[slug] — archive (soft delete) */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { slug } = await params;
  if (!isAgentSlug(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const result = await archiveArenaAgent(slug, auth.user.id);
  if (!result.ok) {
    const status = result.error === "db_unavailable" ? 503 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
