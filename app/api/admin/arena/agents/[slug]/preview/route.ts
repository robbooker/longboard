import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getArenaAdminAgent, isAgentSlug } from "@/lib/arena/agents-store";
import { parseTradeConfig, parseVoiceConfig } from "@/lib/arena/config-parse";
import { getDefaultIdentity, defaultVoiceConfig } from "@/lib/arena/defaults";
import { buildAgentPreview, defaultPeerForSlug } from "@/lib/arena/prompts/preview";
import type { AgentIdentity } from "@/lib/arena/config-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/arena/agents/[slug]/preview — deterministic copy + prompts */
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

  let body: { trade?: unknown; voice?: unknown };
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const record = await getArenaAdminAgent(slug);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const trade = parseTradeConfig(body.trade) ?? record.draftTrade;
  const voice = parseVoiceConfig(body.voice) ?? record.draftVoice;

  const identity: AgentIdentity = {
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    provider: record.provider,
    modelFamily: record.modelFamily,
    modelId: record.modelId,
    providerKey: record.providerKey,
    avatarColor: record.avatarColor,
    bio: record.bio,
    benchmarkSymbol: record.benchmarkSymbol,
    startingCapital: record.startingCapital,
    status: record.status,
  };

  const peerSlug = defaultPeerForSlug(slug);
  const peerDefault = getDefaultIdentity(peerSlug)!;
  const peerIdentity: AgentIdentity = {
    id: peerDefault.id,
    slug: peerDefault.slug,
    displayName: peerDefault.displayName,
    provider: peerDefault.provider,
    modelFamily: peerDefault.modelFamily,
    modelId: peerDefault.modelId,
    providerKey: peerDefault.providerKey,
    avatarColor: peerDefault.avatarColor,
    bio: peerDefault.bio,
    benchmarkSymbol: peerDefault.benchmarkSymbol,
    startingCapital: peerDefault.startingCapital,
    status: peerDefault.status,
  };
  const peerVoice = defaultVoiceConfig(peerSlug);

  const preview = buildAgentPreview(identity, trade, voice, peerIdentity, peerVoice);
  return NextResponse.json({ preview });
}
