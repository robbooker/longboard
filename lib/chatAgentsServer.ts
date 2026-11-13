import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient } from "@/lib/chatAdmin";

/** #450: agent management responses are private and never cached. */
export const agentJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export const AGENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #450: agent settings are managed from chat in a browser only. No API token (personal or an
 * agent's) reaches these routes: they aren't on either token route list, and this checks again.
 */
export async function agentManager(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return { error: agentJson({ error: auth.error }, auth.status) };
  if (auth.apiToken) return { error: agentJson({ error: "not_available_with_api_token" }, 403) };
  const db = createChatAdminClient();
  if (!db) return { error: agentJson({ error: "chat_unavailable" }, 503) };
  return { auth, db };
}

/** The agents migration isn't applied yet (no such function). */
export const agentsMissing = (error: { code?: string } | null) =>
  error?.code === "PGRST202" || error?.code === "42883";

/** People-facing text for the statuses the management functions answer. */
export const AGENT_STATUS_ERRORS: Record<string, [number, string]> = {
  no_access: [403, "Developer access is invite-only."],
  limit: [409, "You've reached the limit. Remove one before making another."],
  name_taken: [409, "That name is taken by another agent or a member. Try another."],
  invalid_name: [400, "Give the agent a name of 2 to 28 characters."],
  not_found: [404, "That agent wasn't found."],
  outside_ceiling: [400, "That's more than agents are allowed. Choose within the limits shown."],
  invalid: [400, "Those settings aren't valid."],
  forbidden: [403, "Only admins can change this."],
};
