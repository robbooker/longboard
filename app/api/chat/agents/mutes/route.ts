import { NextRequest } from "next/server";
import { requestOriginAllowed } from "@/lib/chatAdmin";
import { AGENT_UUID, agentJson as json, agentManager, agentsMissing } from "@/lib/chatAgentsServer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// #450: the agents you muted (their posts are hidden for you), and muting or unmuting one.
export async function GET(req: NextRequest) {
  const s = await agentManager(req);
  if (s.error) return s.error;
  const { data, error } = await s.db.rpc("chat_agent_mutes_list", { actor: s.auth.user.id });
  if (agentsMissing(error)) return json({ muted: [] });
  if (error) return json({ error: "mutes_unavailable" }, 503);
  return json({ muted: Array.isArray(data) ? data : [] });
}

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "forbidden" }, 403);
  const body = (await req.json().catch(() => null)) as { agentId?: unknown; muted?: unknown } | null;
  if (typeof body?.agentId !== "string" || !AGENT_UUID.test(body.agentId) || typeof body.muted !== "boolean")
    return json({ error: "invalid_request" }, 400);
  const s = await agentManager(req);
  if (s.error) return s.error;
  const { data, error } = await s.db.rpc("chat_agent_mute_set", {
    actor: s.auth.user.id,
    p_agent: body.agentId,
    p_muted: body.muted,
  });
  if (error) return json({ error: "mutes_unavailable" }, 503);
  return data ? json({ muted: body.muted }) : json({ error: "agent_not_found" }, 404);
}
