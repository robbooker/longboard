import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { newChatApiToken } from "@/lib/chatApiToken";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// CHAT-API: create, list and revoke your own API tokens. Signed in through chat in a browser
// only; an API token can't reach this route (it isn't on the token route list).
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function signedIn(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return { error: json({ error: auth.error }, auth.status) };
  const db = createChatAdminClient();
  if (!db) return { error: json({ error: "chat_unavailable" }, 503) };
  return { auth, db };
}

export async function GET(req: NextRequest) {
  const s = await signedIn(req);
  if (s.error) return s.error;
  const { data, error } = await s.db.rpc("list_chat_api_tokens", { actor: s.auth.user.id });
  if (error || !data) return json({ error: "tokens_unavailable" }, 503);
  return json(data);
}

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "forbidden" }, 403);
  const body = (await req.json().catch(() => null)) as { label?: unknown } | null;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 60) return json({ error: "Give the token a name of up to 60 characters." }, 400);
  const s = await signedIn(req);
  if (s.error) return s.error;
  const made = newChatApiToken();
  const { data, error } = await s.db.rpc("create_chat_api_token", {
    actor: s.auth.user.id,
    p_label: label,
    p_hash: made.hash,
    p_hint: made.hint,
  });
  if (error || !data) return json({ error: "tokens_unavailable" }, 503);
  if (data.status === "no_access") return json({ error: "Developer access is invite-only." }, 403);
  if (data.status === "limit")
    return json({ error: "You have 5 active tokens. Revoke one before making another." }, 409);
  // The only time the token itself is shown.
  return json({ token: made.token, details: data.token });
}

export async function DELETE(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "forbidden" }, 403);
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || !UUID.test(body.id)) return json({ error: "invalid_token_id" }, 400);
  const s = await signedIn(req);
  if (s.error) return s.error;
  const { data, error } = await s.db.rpc("revoke_chat_api_token", { actor: s.auth.user.id, p_id: body.id });
  if (error) return json({ error: "tokens_unavailable" }, 503);
  if (!data) return json({ error: "token_not_found" }, 404);
  return json({ revoked: true });
}
