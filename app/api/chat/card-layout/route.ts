import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { loadCardOptions } from "@/lib/chatCardOptions.server";
import { SIX_SLOTS, isCardLayoutShape, validateCardLayout } from "@/lib/chatCards";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const VIEWS = { six: SIX_SLOTS } as const;
type View = keyof typeof VIEWS;
const parseView = (value: unknown): View | null => (value === "six" ? value : null);

/**
 * #379: a member's saved card layout for a multi-card view (Six). GET ?view=six returns it checked
 * against what the member can reach right now; POST {view, layout} checks and saves it. Cards the
 * member can't use (unknown types, rooms they're not in, DMs that aren't theirs, the Gainers Table
 * without the Gainers room, repeats) are saved and returned as empty slots; a malformed body is a 400.
 * The account always comes from the verified sign-in, never from the request.
 */
async function handle(req: NextRequest, write: boolean) {
  if (write && !requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  let view: View | null, submitted: unknown;
  if (write) {
    const payload = await req.json().catch(() => null);
    view = parseView(payload?.view);
    submitted = payload?.layout;
    if (!view || !isCardLayoutShape(submitted, VIEWS[view])) return json({ error: "invalid_layout" }, 400);
  } else view = parseView(req.nextUrl.searchParams.get("view"));
  if (!view) return json({ error: "invalid_view" }, 400);
  const loaded = await loadCardOptions(auth);
  if (!loaded.ok) return loaded.response;
  const options = loaded.options;
  const db = createChatAdminClient();
  if (!db) return json({ error: "layout_unavailable" }, 503);
  try {
    if (write) {
      const layout = validateCardLayout(submitted, options, VIEWS[view]);
      const { error } = await db
        .from("chat_card_layouts")
        .upsert({ account_id: auth.user.id, view, slots: layout, updated_at: new Date().toISOString() });
      if (error) return json({ error: "layout_unavailable" }, 503);
      return json({ layout, saved: true });
    }
    const { data, error } = await db
      .from("chat_card_layouts")
      .select("slots")
      .eq("account_id", auth.user.id)
      .eq("view", view)
      .maybeSingle();
    if (error) return json({ error: "layout_unavailable" }, 503);
    return json({ layout: data ? validateCardLayout(data.slots, options, VIEWS[view]) : null, saved: !!data });
  } catch {
    return json({ error: "layout_unavailable" }, 503);
  }
}
export const GET = (req: NextRequest) => handle(req, false);
export const POST = (req: NextRequest) => handle(req, true);
