import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { chatLookOf, chatLookParts, parseChatTheme } from "@/lib/chatTheme";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #407: the member's chat theme, kept on their account so it follows them to any device.
 * GET returns {theme, palette} (null when never chosen); POST {theme, palette} saves them.
 * The account always comes from the verified sign-in, never from the request.
 * #420: `palette` is the colour combination on top of the theme, or null. It has its own column,
 * and `theme` keeps holding one of the four themes (the combination's base), so code that knows
 * nothing about combinations still reads a theme it can show. Until that column exists (the
 * migration lands a little after the code) there is simply no combination: reads and saves fall
 * back to the theme alone.
 */
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const db = createChatAdminClient();
  if (!db) return json({ error: "theme_unavailable" }, 503);
  try {
    const wide = await db
      .from("chat_activity_preferences")
      .select("theme,palette")
      .eq("account_id", auth.user.id)
      .maybeSingle();
    if (!wide.error) return json(saved(wide.data?.theme, wide.data?.palette));
    const { data, error } = await db
      .from("chat_activity_preferences")
      .select("theme")
      .eq("account_id", auth.user.id)
      .maybeSingle();
    if (error) return json({ error: "theme_unavailable" }, 503);
    return json(saved(data?.theme, null));
  } catch {
    return json({ error: "theme_unavailable" }, 503);
  }
}

/** What the account holds, as the page uses it: a combination only on top of its own base theme. */
function saved(theme: unknown, palette: unknown) {
  const parts = chatLookParts(chatLookOf(theme, palette));
  return { theme: parts?.theme ?? null, palette: parts?.palette ?? null };
}

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const payload = await req.json().catch(() => null);
  const theme = parseChatTheme(payload?.theme);
  if (!theme) return json({ error: "invalid_theme" }, 400);
  // A plain theme (or a page from before #420, which sends no palette) clears the combination.
  const { palette } = saved(theme, payload?.palette);
  const db = createChatAdminClient();
  if (!db) return json({ error: "theme_unavailable" }, 503);
  try {
    // Only these columns: the member's other preferences (reply alerts) are left as they are.
    const wide = await db
      .from("chat_activity_preferences")
      .upsert({ account_id: auth.user.id, theme, palette }, { onConflict: "account_id" });
    if (!wide.error) return json({ theme, palette });
    const { error } = await db
      .from("chat_activity_preferences")
      .upsert({ account_id: auth.user.id, theme }, { onConflict: "account_id" });
    if (error) return json({ error: "theme_unavailable" }, 503);
    return json({ theme, palette: null });
  } catch {
    return json({ error: "theme_unavailable" }, 503);
  }
}
