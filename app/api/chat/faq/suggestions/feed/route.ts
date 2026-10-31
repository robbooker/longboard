import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The newest FAQ suggestions for Marketing HQ's review page. Server-to-server and read-only:
// `Authorization: Bearer <CHAT_FAQ_SUGGESTIONS_READ_TOKEN>`, no member or admin session. It refuses
// everything until that env var is set. Each row has the suggestion's own id (to act on it), the
// submitter's name from the members table (null once that member is gone), the review status, the AI's
// draft and the history. The database function picks the columns: no member id, message id or email
// ever leaves this route.

const LIMIT = 1000;
// A draft that never came back (the server stopped first) counts as failed, so it isn't "drafting" forever.
const DRAFT_GIVEN_UP_MS = 3 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const digest = (text: string) => createHash("sha256").update(text).digest();

type Row = { created_at: string; ai_status: string };

export async function GET(req: NextRequest) {
  const secret = process.env.CHAT_FAQ_SUGGESTIONS_READ_TOKEN?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return json({ error: "feed_not_configured" }, 503);
  const given = /^bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  // Hashing first makes both sides the same length, so the comparison never exits early on length.
  if (!given || !timingSafeEqual(digest(given), digest(secret))) return json({ error: "unauthorized" }, 401);

  const db = createChatAdminClient();
  if (!db) return json({ error: "feed_unavailable" }, 503);
  try {
    const { data, error } = await db.rpc("chat_faq_suggestions_feed", { p_limit: LIMIT });
    if (error || !Array.isArray(data)) return json({ error: "feed_unavailable" }, 503);
    const suggestions = (data as Row[]).map((row) => {
      const givenUp = row.ai_status === "pending" && Date.now() - Date.parse(row.created_at) > DRAFT_GIVEN_UP_MS;
      return givenUp ? { ...row, ai_status: "failed" } : row;
    });
    return json({ suggestions, truncated: suggestions.length === LIMIT });
  } catch {
    return json({ error: "feed_unavailable" }, 503);
  }
}
