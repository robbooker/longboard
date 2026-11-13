import { NextRequest } from "next/server";
import { requestOriginAllowed } from "@/lib/chatAdmin";
import { newChatApiToken } from "@/lib/chatApiToken";
import { isReservedChatName } from "@/lib/publicChat";
import {
  AGENT_STATUS_ERRORS,
  AGENT_UUID,
  agentJson as json,
  agentManager,
  agentsMissing,
} from "@/lib/chatAgentsServer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// #450: your agents: list, create, rename, change switches, pause, delete, and their tokens.
// Every check (access, ownership, limits, the ceiling) is in the database functions.
const PATCH_KEYS = new Set([
  "name",
  "readRooms",
  "postRooms",
  "dm",
  "react",
  "thread",
  "perMinute",
  "perDay",
  "paused",
]);

export async function GET(req: NextRequest) {
  const s = await agentManager(req);
  if (s.error) return s.error;
  const { data, error } = await s.db.rpc("chat_agent_list", { actor: s.auth.user.id });
  if (agentsMissing(error)) return json({ access: false, unavailable: true, agents: [] });
  if (error || !data) return json({ error: "agents_unavailable" }, 503);
  return json(data);
}

type Body = {
  action?: unknown;
  name?: unknown;
  agentId?: unknown;
  tokenId?: unknown;
  label?: unknown;
  patch?: unknown;
};
const refused = (status: unknown) => {
  const known = typeof status === "string" ? AGENT_STATUS_ERRORS[status] : undefined;
  return known ? json({ error: known[1], status }, known[0]) : json({ error: "agents_unavailable" }, 503);
};

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "forbidden" }, 403);
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") return json({ error: "invalid_request" }, 400);
  const s = await agentManager(req);
  if (s.error) return s.error;
  const actor = s.auth.user.id;
  const agentId = typeof body.agentId === "string" && AGENT_UUID.test(body.agentId) ? body.agentId : null;
  const name = typeof body.name === "string" ? body.name.trim() : null;
  switch (body.action) {
    case "create": {
      if (!name || name.length < 2 || name.length > 28) return refused("invalid_name");
      if (isReservedChatName(name)) return refused("name_taken");
      const { data, error } = await s.db.rpc("chat_agent_create", { actor, p_name: name });
      if (error || !data) return json({ error: "agents_unavailable" }, 503);
      return data.status === "created" ? json({ agent: data.agent }) : refused(data.status);
    }
    case "update": {
      const patch = body.patch;
      if (!agentId || !patch || typeof patch !== "object" || Array.isArray(patch)) return refused("invalid");
      if (Object.keys(patch).some((key) => !PATCH_KEYS.has(key))) return refused("invalid");
      const next = patch as Record<string, unknown>;
      if (typeof next.name === "string") {
        next.name = next.name.trim();
        if (isReservedChatName(next.name as string)) return refused("name_taken");
      }
      const { data, error } = await s.db.rpc("chat_agent_update", { actor, p_agent: agentId, p_patch: next });
      if (error || !data) return json({ error: "agents_unavailable" }, 503);
      return data.status === "updated" ? json({ agent: data.agent }) : refused(data.status);
    }
    case "delete": {
      if (!agentId) return refused("not_found");
      const { data, error } = await s.db.rpc("chat_agent_delete", { actor, p_agent: agentId });
      if (error) return json({ error: "agents_unavailable" }, 503);
      return data ? json({ deleted: true }) : refused("not_found");
    }
    case "token-create": {
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!agentId) return refused("not_found");
      if (!label || label.length > 60)
        return json({ error: "Give the token a name of up to 60 characters." }, 400);
      const made = newChatApiToken();
      const { data, error } = await s.db.rpc("chat_agent_token_create", {
        actor,
        p_agent: agentId,
        p_label: label,
        p_hash: made.hash,
        p_hint: made.hint,
      });
      if (error || !data) return json({ error: "agents_unavailable" }, 503);
      if (data.status === "limit")
        return json({ error: "This agent has 3 active tokens. Revoke one before making another." }, 409);
      if (data.status !== "created") return refused(data.status);
      // The only time the token itself is shown.
      return json({ token: made.token, details: data.token });
    }
    case "token-revoke": {
      const tokenId = typeof body.tokenId === "string" && AGENT_UUID.test(body.tokenId) ? body.tokenId : null;
      if (!tokenId) return json({ error: "invalid_token_id" }, 400);
      const { data, error } = await s.db.rpc("chat_agent_token_revoke", { actor, p_token: tokenId });
      if (error) return json({ error: "agents_unavailable" }, 503);
      return data ? json({ revoked: true }) : json({ error: "token_not_found" }, 404);
    }
    default:
      return json({ error: "unknown_action" }, 400);
  }
}
