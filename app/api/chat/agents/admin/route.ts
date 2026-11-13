import { NextRequest } from "next/server";
import { requestOriginAllowed } from "@/lib/chatAdmin";
import {
  AGENT_STATUS_ERRORS,
  AGENT_UUID,
  agentJson as json,
  agentManager,
  agentsMissing,
} from "@/lib/chatAgentsServer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// #450: admins only: the global ceiling for every agent, and a pause switch for any agent.
// The database checks the admin role again (chat_agent_is_admin).
const CEILING_KEYS = new Set([
  "readRooms",
  "postRooms",
  "dm",
  "react",
  "thread",
  "perMinute",
  "perDay",
  "maxTurns",
]);

async function adminOnly(req: NextRequest) {
  const s = await agentManager(req);
  if (s.error) return s;
  if (!s.auth.access.admin || s.auth.user.role !== "admin")
    return { error: json({ error: "admin_only" }, 403) };
  return s;
}
const refused = (status: unknown) => {
  const known = typeof status === "string" ? AGENT_STATUS_ERRORS[status] : undefined;
  return known ? json({ error: known[1], status }, known[0]) : json({ error: "agents_unavailable" }, 503);
};

export async function GET(req: NextRequest) {
  const s = await adminOnly(req);
  if (s.error) return s.error;
  const { data, error } = await s.db.rpc("chat_agent_admin_list", { actor: s.auth.user.id });
  if (agentsMissing(error)) return json({ unavailable: true }, 503);
  if (error || !data) return json({ error: "agents_unavailable" }, 503);
  return data.status === "ok" ? json(data) : refused(data.status);
}

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "forbidden" }, 403);
  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    ceiling?: unknown;
    agentId?: unknown;
    paused?: unknown;
  } | null;
  if (!body || typeof body !== "object") return json({ error: "invalid_request" }, 400);
  const s = await adminOnly(req);
  if (s.error) return s.error;
  const actor = s.auth.user.id;
  if (body.action === "ceiling") {
    const ceiling = body.ceiling;
    if (!ceiling || typeof ceiling !== "object" || Array.isArray(ceiling)) return refused("invalid");
    if (Object.keys(ceiling).some((key) => !CEILING_KEYS.has(key))) return refused("invalid");
    const { data, error } = await s.db.rpc("chat_agent_ceiling_update", { actor, p_patch: ceiling });
    if (error || !data) return json({ error: "agents_unavailable" }, 503);
    return data.status === "updated" ? json({ ceiling: data.ceiling }) : refused(data.status);
  }
  if (body.action === "pause") {
    if (
      typeof body.agentId !== "string" ||
      !AGENT_UUID.test(body.agentId) ||
      typeof body.paused !== "boolean"
    )
      return refused("invalid");
    const { data, error } = await s.db.rpc("chat_agent_admin_pause", {
      actor,
      p_agent: body.agentId,
      p_paused: body.paused,
    });
    if (error || !data) return json({ error: "agents_unavailable" }, 503);
    return data.status === "updated" ? json({ paused: body.paused }) : refused(data.status);
  }
  return json({ error: "unknown_action" }, 400);
}
