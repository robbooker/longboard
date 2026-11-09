import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { parseChatTheme } from "@/lib/chatTheme";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #407: the member's chat theme, kept on their account so it follows them to any device.
 * GET returns {theme} (null when never chosen); POST {theme} saves one of the chat themes.
 * The account always comes from the verified sign-in, never from the request.
 */
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const db = createChatAdminClient();
  if (!db) return json({ error: "theme_unavailable" }, 503);
  try {
    const { data, error } = await db
      .from("chat_activity_preferences")
      .select("theme")
      .eq("account_id", auth.user.id)
      .maybeSingle();
    if (error) return json({ error: "theme_unavailable" }, 503);
    return json({ theme: parseChatTheme(data?.theme) });
  } catch {
    return json({ error: "theme_unavailable" }, 503);
  }
}

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const payload = await req.json().catch(() => null);
  const theme = parseChatTheme(payload?.theme);
  if (!theme) return json({ error: "invalid_theme" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "theme_unavailable" }, 503);
  try {
    // Only the theme column: the member's other preferences (reply alerts) are left as they are.
    const { error } = await db
      .from("chat_activity_preferences")
      .upsert({ account_id: auth.user.id, theme }, { onConflict: "account_id" });
    if (error) return json({ error: "theme_unavailable" }, 503);
    return json({ theme });
  } catch {
    return json({ error: "theme_unavailable" }, 503);
  }
}
