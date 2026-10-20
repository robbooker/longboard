import { isChatPushPreview, type ChatPushPreview } from "@/lib/chatPushPreview";
import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { allowedChatRooms } from "@/lib/chatAccess";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { parsePushSubscription, pushConfiguration, validPushEndpoint } from "@/lib/chatPush";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// GAINERS-PUSH: the Gainers switch is offered only to people who can read the Gainers channel.
const hasGainers = (access: Parameters<typeof allowedChatRooms>[0] | undefined) =>
  !!access && allowedChatRooms(access).includes("gainers");
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const config = pushConfiguration();
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  let subscribed = false;
  let preview = "off";
  let gainers = false;
  if (endpoint) {
    if (!validPushEndpoint(endpoint)) return json({ error: "invalid_endpoint" }, 400);
    const db = createChatAdminClient();
    if (!db) return json({ error: "push_unavailable" }, 503);
    const result = await db
      .from("chat_push_subscriptions")
      .select("id,preview_mode,gainers")
      .eq("account_id", auth.user.id)
      .eq("endpoint", endpoint)
      .maybeSingle();
    if (result.error) return json({ error: "push_unavailable" }, 503);
    subscribed = !!result.data;
    preview = result.data?.preview_mode ?? "off";
    gainers = result.data?.gainers === true;
  }
  return json({
    accountId: auth.user.id,
    configured: !!config,
    publicKey: config?.publicKey ?? null,
    subscribed,
    preview,
    gainers,
    gainersAvailable: hasGainers(auth.access),
  });
}
async function mutate(req: NextRequest, remove: boolean) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (Number(req.headers.get("content-length")) > 4096) return json({ error: "invalid_subscription" }, 400);
  const body = await req.json().catch(() => null);
  if (body?.accountId !== auth.user.id) return json({ error: "account_changed" }, 409);
  const db = createChatAdminClient();
  if (!db) return json({ error: "push_unavailable" }, 503);
  if (remove) {
    if (!validPushEndpoint(body.endpoint)) return json({ error: "invalid_endpoint" }, 400);
    const result = await db
      .from("chat_push_subscriptions")
      .delete()
      .eq("account_id", auth.user.id)
      .eq("endpoint", body.endpoint);
    return result.error ? json({ error: "push_unavailable" }, 503) : json({ ok: true });
  }
  if (!pushConfiguration()) return json({ error: "push_not_configured" }, 503);
  const subscription = parsePushSubscription(body.subscription);
  if (!subscription) return json({ error: "invalid_subscription" }, 400);
  const known = await db
    .from("chat_push_subscriptions")
    .select("id")
    .eq("account_id", auth.user.id)
    .eq("endpoint", subscription.endpoint)
    .maybeSingle();
  if (known.error) return json({ error: "push_unavailable" }, 503);
  const result = await db.rpc("save_chat_push_subscription", {
    actor: auth.user.id,
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.keys.p256dh,
    p_auth: subscription.keys.auth,
  });
  if (result.error)
    return json(
      {
        error:
          result.error.message === "push_rate_limited" ? "push_rate_limited" : "subscription_unavailable",
      },
      result.error.message === "push_rate_limited" ? 429 : 409,
    );
  return json({
    ok: true,
    preview: known.data ? undefined : await inheritPreview(db, auth.user.id, subscription.endpoint),
  });
}
// A new device starts with this account's most recent preview choice on another
// device, so re-subscribing or adding a phone doesn't silently reset it to off.
// Accounts that never chose previews stay private ("off").
async function inheritPreview(
  db: NonNullable<ReturnType<typeof createChatAdminClient>>,
  account: string,
  endpoint: string,
): Promise<ChatPushPreview> {
  const latest = await db
    .from("chat_push_subscriptions")
    .select("preview_mode")
    .eq("account_id", account)
    .neq("endpoint", endpoint)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const preview = latest.data?.preview_mode;
  if (latest.error || !isChatPushPreview(preview) || preview === "off") return "off";
  const saved = await db.rpc("set_chat_push_preview", {
    actor: account,
    p_endpoint: endpoint,
    p_preview: preview,
  });
  return !saved.error && saved.data === true ? preview : "off";
}
export async function POST(req: NextRequest) {
  return mutate(req, false);
}
export async function DELETE(req: NextRequest) {
  return mutate(req, true);
}

export async function PATCH(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (Number(req.headers.get("content-length")) > 4096) return json({ error: "invalid_preferences" }, 400);
  const body = await req.json().catch(() => null);
  if (body?.accountId !== auth.user.id) return json({ error: "account_changed" }, 409);
  if (typeof body.gainers === "boolean") return setGainers(auth, body.endpoint, body.gainers);
  if (!validPushEndpoint(body.endpoint) || !isChatPushPreview(body.preview))
    return json({ error: "invalid_preferences" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "push_unavailable" }, 503);
  const result = await db.rpc("set_chat_push_preview", {
    actor: auth.user.id,
    p_endpoint: body.endpoint,
    p_preview: body.preview,
  });
  return result.error
    ? json({ error: "push_unavailable" }, 503)
    : result.data === true
      ? json({ ok: true, preview: body.preview })
      : json({ error: "subscription_unavailable" }, 404);
}

// GAINERS-PUSH: per device, like previews. Turning it off is always allowed.
async function setGainers(
  auth: { user: { id: string }; access?: Parameters<typeof allowedChatRooms>[0] },
  endpoint: unknown,
  gainers: boolean,
) {
  if (!validPushEndpoint(endpoint)) return json({ error: "invalid_preferences" }, 400);
  if (gainers && !hasGainers(auth.access)) return json({ error: "room_unavailable" }, 403);
  const db = createChatAdminClient();
  if (!db) return json({ error: "push_unavailable" }, 503);
  const result = await db.rpc("set_chat_push_gainers", {
    actor: auth.user.id,
    p_endpoint: endpoint,
    p_gainers: gainers,
  });
  return result.error
    ? json({ error: "push_unavailable" }, 503)
    : result.data === true
      ? json({ ok: true, gainers })
      : json({ error: "subscription_unavailable" }, 404);
}
