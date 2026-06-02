import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getArenaAdminAgent, isAgentSlug } from "@/lib/arena/agents-store";
import { parseVoiceConfig } from "@/lib/arena/config-parse";
import { generateVoiceSample } from "@/lib/arena/generate-voice-sample";
import type { AgentIdentity } from "@/lib/arena/config-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/arena/agents/[slug]/test-voice — live LLM sample from draft voice config */
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

  let body: { voice?: unknown };
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const record = await getArenaAdminAgent(slug);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });

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

  const result = await generateVoiceSample(identity, voice, record.modelId);
  if (!result.ok) {
    const status =
      result.error === "no_api_key"
        ? 503
        : result.error === "provider_not_supported_yet"
          ? 501
          : 502;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ text: result.text });
}
