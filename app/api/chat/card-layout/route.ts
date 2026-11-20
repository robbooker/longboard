import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { loadCardOptions } from "@/lib/chatCardOptions.server";
import { SIX_SLOTS, isCardLayoutShape, validateCardLayout } from "@/lib/chatCards";
import { isSixWidthsShape, parseSixWidths } from "@/lib/chatSixWidths";
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
 *
 * #470: the row also keeps Six's card widths (`widths`, or null for even). GET returns them as
 * `widths`; a POST that includes `widths` saves them (null resets to even), and one without leaves
 * them as they are. #474: widths are six shares, two rows of three, so each card has its own width;
 * a #470 value (three shares, one per column) is still accepted and read as the same for both rows. Until the column exists (the migration lands a little after the
 * code) GET leaves `widths` out and a POST saves the cards alone with `widthsSaved: false`, so the
 * page keeps the widths in the browser.
 */
async function handle(req: NextRequest, write: boolean) {
  if (write && !requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  let view: View | null, submitted: unknown, widths: number[] | null | undefined;
  if (write) {
    const payload = await req.json().catch(() => null);
    view = parseView(payload?.view);
    submitted = payload?.layout;
    if (!view || !isCardLayoutShape(submitted, VIEWS[view])) return json({ error: "invalid_layout" }, 400);
    if (payload && typeof payload === "object" && "widths" in payload) {
      if (!isSixWidthsShape(payload.widths)) return json({ error: "invalid_widths" }, 400);
      widths = parseSixWidths(payload.widths);
    }
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
      const row = { account_id: auth.user.id, view, slots: layout, updated_at: new Date().toISOString() };
      if (widths !== undefined) {
        const wide = await db.from("chat_card_layouts").upsert({ ...row, widths });
        if (!wide.error) return json({ layout, saved: true, widths, widthsSaved: true });
      }
      const { error } = await db.from("chat_card_layouts").upsert(row);
      if (error) return json({ error: "layout_unavailable" }, 503);
      return json(
        widths === undefined ? { layout, saved: true } : { layout, saved: true, widthsSaved: false },
      );
    }
    const read = (columns: string) =>
      db
        .from("chat_card_layouts")
        .select(columns)
        .eq("account_id", auth.user.id)
        .eq("view", view)
        .maybeSingle();
    const wide = await read("slots,widths");
    const { data, error } = wide.error ? await read("slots") : wide;
    if (error) return json({ error: "layout_unavailable" }, 503);
    const saved = data as { slots: unknown; widths?: unknown } | null;
    return json({
      layout: saved ? validateCardLayout(saved.slots, options, VIEWS[view]) : null,
      saved: !!saved,
      ...(wide.error ? {} : { widths: saved ? parseSixWidths(saved.widths) : null }),
    });
  } catch {
    return json({ error: "layout_unavailable" }, 503);
  }
}
export const GET = (req: NextRequest) => handle(req, false);
export const POST = (req: NextRequest) => handle(req, true);
